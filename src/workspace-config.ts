import Ajv, { Schema, ValidateFunction } from 'ajv'
import * as vscode from 'vscode'
import { Document, parseDocument } from 'yaml'
import { Node, Scalar, YAMLMap } from 'yaml/types'
import { info, warn } from './logging'
import { readOptionalFile } from './utils/fs-utils'

export const melosYamlFile = 'melos.yaml'

/**
 * A Melos workspace configuration.
 *
 * Only data currently used by the extension is included.
 */
export interface MelosWorkspaceConfig {
  /**
   * The YAML document from which the configuration was parsed.
   */
  yamlDoc: Document
  /**
   * The configured Melos scripts.
   */
  scripts: MelosScriptConfig[]
}

/**
 * Configuration for a Melos script.
 */
export interface MelosScriptConfig {
  /**
   * The name of the script.
   */
  name: MelosScriptName

  /**
   * The command to run for the script.
   */
  run?: MelosScriptCommand
}

/**
 * The name of a Melos script.
 */
export interface MelosScriptName {
  /**
   * The name of the script.
   */
  value: string
  /**
   * The YAML node that contains the name.
   */
  yamlNode: Node
}

/**
 * A command to run for a Melos script.
 */
export interface MelosScriptCommand {
  /**
   * The command to run.
   */
  value: string
  /**
   * The YAML node that contains the name.
   */
  yamlNode: Node
}

/**
 * Parses the given string as a melos.yaml file.
 *
 * As much as possible of the file is parsed, even if it is invalid.
 */
export function parseMelosWorkspaceConfig(text: string): MelosWorkspaceConfig {
  const doc = parseDocument(text, { keepCstNodes: true })
  return melosWorkspaceConfigFromYamlDoc(doc)
}

/**
 * Returns whether the given workspace configuration was created from a valid
 * file.
 */
export async function isMelosWorkspaceConfigValid(
  context: vscode.ExtensionContext,
  config: MelosWorkspaceConfig
): Promise<boolean> {
  const validate = await getValidateMelosYamlFunction(context)
  return !!validate(config.yamlDoc.toJSON())
}

/**
 * Loads and parses the melos.yaml file for the given workspace {@link folder}.
 *
 * Returns null if the files does not exist.
 *
 * If the file is invalid a warning message is displayed to the user.
 * The partially parsed config is still returned.
 * Validation is base on the JSON schema defined in the
 * {@link melosYamlSchemaFile} file.
 *
 * @param context The extension context.
 */
export async function loadMelosWorkspaceConfig(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder
): Promise<MelosWorkspaceConfig | null> {
  const configFile = await readOptionalFile(
    vscode.Uri.joinPath(folder.uri, melosYamlFile)
  )

  if (configFile === null) {
    return null
  }

  const config = parseMelosWorkspaceConfig(configFile.toString())

  if (await isMelosWorkspaceConfigValid(context, config)) {
    info(`Loaded valid ${melosYamlFile} from '${folder.name}' folder`)
  } else {
    warn(`Loaded invalid ${melosYamlFile} from '${folder.name}' folder`)
    showInvalidMelosYamlMessage(folder)
  }

  return config
}

function showInvalidMelosYamlMessage(folder: vscode.WorkspaceFolder) {
  vscode.window.showWarningMessage(
    `The ${melosYamlFile} file in the ${folder.name} folder is invalid.`
  )
}

function melosWorkspaceConfigFromYamlDoc(doc: Document): MelosWorkspaceConfig {
  return {
    yamlDoc: doc,
    scripts: melosScriptsConfigsFromYaml(doc.get('scripts')),
  }
}

function melosScriptsConfigsFromYaml(value: any): MelosScriptConfig[] {
  if (!(value instanceof YAMLMap)) {
    return []
  }

  return value.items
    .filter((entry) => {
      const name = entry.key
      return name instanceof Scalar && typeof name.value === 'string'
    })
    .map((entry) => {
      const name = entry.key as Scalar

      const scriptName = {
        value: name.value,
        yamlNode: name,
      }

      const definition = entry.value
      if (definition instanceof Scalar) {
        return {
          name: scriptName,
          run: melosScriptCommandFromYaml(definition),
        }
      }

      if (definition instanceof YAMLMap) {
        return {
          name: scriptName,
          run: melosScriptCommandFromYaml(definition.get('run', true)),
        }
      }

      return { name: scriptName }
    })
}

function melosScriptCommandFromYaml(
  value: any
): MelosScriptCommand | undefined {
  if (value instanceof Scalar && typeof value.value === 'string') {
    return {
      value: value.value,
      yamlNode: value,
    }
  }

  return undefined
}

// === melos.yaml schema ======================================================

/**
 * Location of melos.yaml schema file relative to extension root.
 */
const melosYamlSchemaFile = 'melos.yaml.schema.json'

let validateMelosYamlFunction: Promise<ValidateFunction> | undefined

async function getValidateMelosYamlFunction(
  context: vscode.ExtensionContext
): Promise<ValidateFunction> {
  return (validateMelosYamlFunction ??= loadMelosYamlSchema(
    context.extensionUri
  ).then((schema) => new Ajv().compile(schema)))
}

async function loadMelosYamlSchema(extensionUri: vscode.Uri): Promise<Schema> {
  const rawSchema = await vscode.workspace.fs.readFile(
    vscode.Uri.joinPath(extensionUri, melosYamlSchemaFile)
  )
  return JSON.parse(rawSchema.toString())
}
