/**
 * check 命令 - 检测 API 变更
 */

import * as fs from 'fs'
import * as path from 'path'
import {
  Config,
  ChangeReport,
  ModuleChangeReport,
  TypeChange,
  APIChange,
  FieldChange,
  ParsedAPI,
  ParsedType,
  SchemaObject
} from '../types'
import { loadSwagger, parseSwagger } from '../core/parser'
import { schemaToTsType } from '../generators/typeGenerator'
import { extractExistingApis, AUTO_GEN_START, AUTO_GEN_END } from '../generators/apiGenerator'
import { loadTagMapping } from '../core/tagMapping'

/**
 * 执行 check 命令
 */
export async function runCheck(config: Config): Promise<ChangeReport> {
  console.log('正在加载 Swagger 规范...')
  const spec = await loadSwagger(config.input)

  // 加载 tag 映射（优先使用 config 中的配置）
  const tagMapping = loadTagMapping(config.output, config.tagMapping)

  console.log('正在解析 Swagger...')
  const { apis, types } = parseSwagger(spec, config, tagMapping)

  console.log('正在检测变更...')
  const report = detectChanges(apis, types, config)

  // 生成 changelog.md
  const changelogPath = path.join(process.cwd(), 'changelog.md')
  const changelogContent = generateChangelog(report)
  fs.writeFileSync(changelogPath, changelogContent, 'utf-8')

  console.log(`变更报告已生成: ${changelogPath}`)

  return report
}

/**
 * 检测变更
 */
function detectChanges(
  newApis: Map<string, ParsedAPI[]>,
  newTypes: Map<string, ParsedType[]>,
  config: Config
): ChangeReport {
  const modules: ModuleChangeReport[] = []

  // 遍历所有模块
  for (const [moduleName, apis] of newApis) {
    const moduleDir = path.join(config.output, moduleName)
    const typesFile = path.join(moduleDir, 'types.ts')
    const apiFile = path.join(moduleDir, 'index.ts')

    const typeChanges: TypeChange[] = []
    const apiChanges: APIChange[] = []

    // 检测类型变更
    if (fs.existsSync(typesFile)) {
      const existingContent = fs.readFileSync(typesFile, 'utf-8')
      const moduleTypes = newTypes.get(moduleName) || []

      for (const newType of moduleTypes) {
        const typeChange = detectTypeChange(newType, existingContent, config)
        if (typeChange) {
          typeChanges.push(typeChange)
        }
      }

      // 检测删除的类型
      const deletedTypes = detectDeletedTypes(moduleTypes, existingContent)
      typeChanges.push(...deletedTypes)
    } else {
      // 文件不存在，所有类型都是新增
      const moduleTypes = newTypes.get(moduleName) || []
      for (const type of moduleTypes) {
        typeChanges.push({
          typeName: type.name,
          changeType: 'added',
          fields: []
        })
      }
    }

    // 检测 API 变更
    if (fs.existsSync(apiFile)) {
      const existingContent = fs.readFileSync(apiFile, 'utf-8')
      const existingApis = extractExistingApis(existingContent)

      for (const newApi of apis) {
        if (!existingApis.has(newApi.functionName)) {
          apiChanges.push({
            path: newApi.path,
            method: newApi.method,
            changeType: 'added',
            functionName: newApi.functionName
          })
        }
      }

      // 检测删除的 API
      const newApiFunctions = new Set(apis.map(a => a.functionName))
      for (const [funcName] of existingApis) {
        if (!newApiFunctions.has(funcName)) {
          apiChanges.push({
            path: '',
            method: '',
            changeType: 'removed',
            functionName: funcName
          })
        }
      }
    } else {
      // 文件不存在，所有 API 都是新增
      for (const api of apis) {
        apiChanges.push({
          path: api.path,
          method: api.method,
          changeType: 'added',
          functionName: api.functionName
        })
      }
    }

    if (typeChanges.length > 0 || apiChanges.length > 0) {
      modules.push({
        moduleName,
        typeChanges,
        apiChanges
      })
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    modules
  }
}

/**
 * 检测单个类型的变更
 */
function detectTypeChange(
  newType: ParsedType,
  existingContent: string,
  config: Config
): TypeChange | null {
  // 匹配 interface 或 type 定义
  const interfaceRegex = new RegExp(
    `export\\s+(?:interface|type)\\s+${newType.name}\\s*(?:extends[^{]*)?\\{([^}]*)\\}`,
    's'
  )

  const match = existingContent.match(interfaceRegex)

  if (!match) {
    // 类型不存在，是新增
    return {
      typeName: newType.name,
      changeType: 'added',
      fields: []
    }
  }

  // 解析现有字段
  const existingFields = parseFieldsFromContent(match[1])

  // 解析新字段
  const newFields = parseFieldsFromSchema(newType.schema, config)

  // 比较字段
  const fieldChanges = compareFields(existingFields, newFields)

  if (fieldChanges.length > 0) {
    return {
      typeName: newType.name,
      changeType: 'modified',
      fields: fieldChanges
    }
  }

  return null
}

/**
 * 从文件内容解析字段
 */
function parseFieldsFromContent(content: string): Map<string, string> {
  const fields = new Map<string, string>()

  // 匹配 fieldName?: type 或 fieldName: type
  const fieldRegex = /(\w+)\??\s*:\s*([^;\n]+)/g
  let match

  while ((match = fieldRegex.exec(content)) !== null) {
    const fieldName = match[1]
    const fieldType = match[2].trim()
    fields.set(fieldName, fieldType)
  }

  return fields
}

/**
 * 从 schema 解析字段
 */
function parseFieldsFromSchema(
  schema: SchemaObject,
  config: Config
): Map<string, string> {
  const fields = new Map<string, string>()

  if (schema.properties) {
    for (const [name, prop] of Object.entries(schema.properties)) {
      const tsType = schemaToTsType(prop, config)
      fields.set(name, tsType)
    }
  }

  // 处理 allOf
  if (schema.allOf) {
    for (const item of schema.allOf) {
      if (item.properties) {
        for (const [name, prop] of Object.entries(item.properties)) {
          const tsType = schemaToTsType(prop, config)
          fields.set(name, tsType)
        }
      }
    }
  }

  return fields
}

/**
 * 比较字段变更
 */
function compareFields(
  oldFields: Map<string, string>,
  newFields: Map<string, string>
): FieldChange[] {
  const changes: FieldChange[] = []

  // 检测新增和修改
  for (const [name, newType] of newFields) {
    if (!oldFields.has(name)) {
      changes.push({
        field: name,
        changeType: 'added',
        newType
      })
    } else {
      const oldType = oldFields.get(name)!
      // 简化类型比较（去掉空格）
      if (normalizeType(oldType) !== normalizeType(newType)) {
        changes.push({
          field: name,
          changeType: 'modified',
          oldType,
          newType
        })
      }
    }
  }

  // 检测删除
  for (const [name, oldType] of oldFields) {
    if (!newFields.has(name)) {
      changes.push({
        field: name,
        changeType: 'removed',
        oldType
      })
    }
  }

  return changes
}

/**
 * 标准化类型字符串（用于比较）
 */
function normalizeType(type: string): string {
  return type.replace(/\s+/g, ' ').trim()
}

/**
 * 检测删除的类型
 */
function detectDeletedTypes(
  newTypes: ParsedType[],
  existingContent: string
): TypeChange[] {
  const deletedTypes: TypeChange[] = []

  // 匹配所有现有的类型定义
  const typeRegex = /export\s+(?:interface|type)\s+(\w+)/g
  const existingTypeNames = new Set<string>()

  let match
  while ((match = typeRegex.exec(existingContent)) !== null) {
    existingTypeNames.add(match[1])
  }

  const newTypeNames = new Set(newTypes.map(t => t.name))

  for (const existingName of existingTypeNames) {
    if (!newTypeNames.has(existingName)) {
      deletedTypes.push({
        typeName: existingName,
        changeType: 'removed',
        fields: []
      })
    }
  }

  return deletedTypes
}

/**
 * 生成 changelog 内容
 */
function generateChangelog(report: ChangeReport): string {
  const lines: string[] = []

  lines.push('# API 变更检测报告')
  lines.push('')
  lines.push(`生成时间: ${new Date(report.generatedAt).toLocaleString('zh-CN')}`)
  lines.push('')

  if (report.modules.length === 0) {
    lines.push('未检测到任何变更')
    return lines.join('\n')
  }

  for (const module of report.modules) {
    lines.push(`## ${module.moduleName} 模块`)
    lines.push('')

    // 类型变更
    if (module.typeChanges.length > 0) {
      lines.push('### 类型变更')
      lines.push('')

      for (const change of module.typeChanges) {
        const icon = change.changeType === 'added' ? '+' :
                    change.changeType === 'removed' ? '-' : '~'

        if (change.changeType === 'added') {
          lines.push(`- ${icon} **${change.typeName}**: 新增类型`)
        } else if (change.changeType === 'removed') {
          lines.push(`- ${icon} **${change.typeName}**: 已删除`)
        } else {
          lines.push(`- ${icon} **${change.typeName}**:`)
          for (const field of change.fields) {
            const fieldIcon = field.changeType === 'added' ? '+' :
                            field.changeType === 'removed' ? '-' : '~'
            if (field.changeType === 'added') {
              lines.push(`  - ${fieldIcon} \`${field.field}\`: ${field.newType} (新增)`)
            } else if (field.changeType === 'removed') {
              lines.push(`  - ${fieldIcon} \`${field.field}\`: ${field.oldType} (删除)`)
            } else {
              lines.push(`  - ${fieldIcon} \`${field.field}\`: ${field.oldType} -> ${field.newType} (类型变更)`)
            }
          }
        }
      }
      lines.push('')
    }

    // API 变更
    if (module.apiChanges.length > 0) {
      lines.push('### API 变更')
      lines.push('')

      const addedApis = module.apiChanges.filter(a => a.changeType === 'added')
      const removedApis = module.apiChanges.filter(a => a.changeType === 'removed')

      if (addedApis.length > 0) {
        lines.push('**新增接口:**')
        for (const api of addedApis) {
          lines.push(`- + \`${api.method.toUpperCase()} ${api.path}\` → ${api.functionName}`)
        }
        lines.push('')
      }

      if (removedApis.length > 0) {
        lines.push('**删除接口:**')
        for (const api of removedApis) {
          lines.push(`- - \`${api.functionName}\``)
        }
        lines.push('')
      }
    }
  }

  return lines.join('\n')
}
