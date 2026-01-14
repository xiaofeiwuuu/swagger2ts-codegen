/**
 * TypeScript 类型生成器
 */

import { SchemaObject, ParsedType, ParsedAPI, Config, Parameter } from '../types'
import { cleanTypeName, toPascalCase } from '../utils/naming'

/**
 * 检查是否是合法的 JS/TS 标识符
 */
function isValidIdentifier(name: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)
}

/**
 * 处理属性名，不合法的用引号包裹
 */
function formatPropertyName(name: string): string {
  if (isValidIdentifier(name)) {
    return name
  }
  // 用引号包裹不合法的属性名
  return `'${name}'`
}

/**
 * 从 $ref 中提取类型名（支持 Swagger 2.0 和 OpenAPI 3.0）
 */
function extractRefName(ref: string): string {
  // OpenAPI 3.0: #/components/schemas/TypeName
  if (ref.includes('#/components/schemas/')) {
    return ref.replace('#/components/schemas/', '')
  }
  // Swagger 2.0: #/definitions/TypeName
  return ref.replace('#/definitions/', '')
}

/**
 * 生成类型定义文件内容
 */
export function generateTypesFile(
  types: ParsedType[],
  apis: ParsedAPI[],
  config: Config
): string {
  const lines: string[] = []

  lines.push('/**')
  lines.push(' * 此文件由 swagger-typegen 自动生成，请勿手动修改')
  lines.push(' */')
  lines.push('')

  // 去重类型名
  const typeMap = new Map<string, ParsedType>()
  for (const type of types) {
    if (!typeMap.has(type.name)) {
      typeMap.set(type.name, type)
    }
  }

  // 生成类型定义
  for (const [, type] of typeMap) {
    const tsCode = generateTypeDefinition(type.name, type.schema, config)
    lines.push(tsCode)
    lines.push('')
  }

  // 为 API 的 query 参数生成类型
  for (const api of apis) {
    if (api.queryParams.length > 0 && api.paramsTypeName) {
      const tsCode = generateQueryParamsType(api.paramsTypeName, api.queryParams, config)
      lines.push(tsCode)
      lines.push('')
    }
  }

  return lines.join('\n')
}

/**
 * 生成单个类型定义
 */
export function generateTypeDefinition(
  name: string,
  schema: SchemaObject,
  config: Config
): string {
  const lines: string[] = []

  // 添加注释
  if (schema.description) {
    lines.push(`/** ${schema.description} */`)
  }

  // 处理 allOf
  if (schema.allOf) {
    const mergedProps: Record<string, SchemaObject> = {}
    const mergedRequired: string[] = []
    const extendsTypes: string[] = []

    for (const item of schema.allOf) {
      if (item.$ref) {
        const refName = cleanTypeName(
          extractRefName(item.$ref),
          config.typeNameSuffixFilter
        )
        extendsTypes.push(refName)
      }
      if (item.properties) {
        Object.assign(mergedProps, item.properties)
      }
      if (item.required) {
        mergedRequired.push(...item.required)
      }
    }

    if (extendsTypes.length > 0 && Object.keys(mergedProps).length === 0) {
      // 纯继承，使用 type alias
      lines.push(`export type ${name} = ${extendsTypes.join(' & ')}`)
    } else {
      // 有额外属性，生成 interface extends
      const extendsClause = extendsTypes.length > 0 ? ` extends ${extendsTypes.join(', ')}` : ''
      lines.push(`export interface ${name}${extendsClause} {`)

      for (const [propName, propSchema] of Object.entries(mergedProps)) {
        // 跳过需要排除的字段
        if (config.excludeFields.includes(propName)) {
          continue
        }
        const isRequired = mergedRequired.includes(propName)
        const propLine = generateProperty(propName, propSchema, isRequired, config)
        lines.push(`  ${propLine}`)
      }

      lines.push('}')
    }

    return lines.join('\n')
  }

  // 处理枚举
  if (schema.enum) {
    const enumValues = schema.enum
      .map(v => typeof v === 'string' ? `'${v}'` : v)
      .join(' | ')
    lines.push(`export type ${name} = ${enumValues}`)
    return lines.join('\n')
  }

  // 处理普通对象
  if (schema.type === 'object' || schema.properties) {
    lines.push(`export interface ${name} {`)

    if (schema.properties) {
      const required = schema.required || []
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        // 跳过需要排除的字段
        if (config.excludeFields.includes(propName)) {
          continue
        }
        const isRequired = required.includes(propName)
        const propLine = generateProperty(propName, propSchema, isRequired, config)
        lines.push(`  ${propLine}`)
      }
    }

    // 处理 additionalProperties
    if (schema.additionalProperties) {
      if (typeof schema.additionalProperties === 'boolean') {
        lines.push('  [key: string]: unknown')
      } else {
        const valueType = schemaToTsType(schema.additionalProperties, config)
        lines.push(`  [key: string]: ${valueType}`)
      }
    }

    lines.push('}')
    return lines.join('\n')
  }

  // 处理基本类型 alias
  const tsType = schemaToTsType(schema, config)
  lines.push(`export type ${name} = ${tsType}`)

  return lines.join('\n')
}

/**
 * 生成属性定义
 */
function generateProperty(
  name: string,
  schema: SchemaObject,
  required: boolean,
  config: Config
): string {
  const propName = formatPropertyName(name)
  const optional = required ? '' : '?'
  const tsType = schemaToTsType(schema, config)

  let line = ''

  // 添加注释
  if (schema.description) {
    line += `/** ${schema.description} */\n  `
  }

  line += `${propName}${optional}: ${tsType}`

  return line
}

/**
 * 为 query 参数生成类型
 */
function generateQueryParamsType(name: string, params: Parameter[], config: Config): string {
  const lines: string[] = []

  lines.push(`export interface ${name} {`)

  for (const param of params) {
    // 跳过空名或纯符号的参数名（如 "-"）
    if (!param.name || param.name === '-') {
      continue
    }

    // 跳过需要排除的字段（这些字段在请求拦截器中自动注入）
    if (config.excludeFields.includes(param.name)) {
      continue
    }

    const propName = formatPropertyName(param.name)
    const optional = param.required ? '' : '?'
    const tsType = parameterToTsType(param)

    if (param.description) {
      lines.push(`  /** ${param.description} */`)
    }
    lines.push(`  ${propName}${optional}: ${tsType}`)
  }

  lines.push('}')

  return lines.join('\n')
}

/**
 * Schema 转 TypeScript 类型
 */
export function schemaToTsType(schema: SchemaObject, config: Config): string {
  if (schema.$ref) {
    return cleanTypeName(
      extractRefName(schema.$ref),
      config.typeNameSuffixFilter
    )
  }

  if (schema.allOf) {
    const types = schema.allOf.map(s => schemaToTsType(s, config))
    return types.join(' & ')
  }

  if (schema.enum) {
    return schema.enum
      .map(v => typeof v === 'string' ? `'${v}'` : v)
      .join(' | ')
  }

  switch (schema.type) {
    case 'string':
      return 'string'
    case 'integer':
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'array':
      if (schema.items) {
        const itemType = schemaToTsType(schema.items, config)
        return `${itemType}[]`
      }
      return 'unknown[]'
    case 'object':
      if (schema.properties) {
        // 内联对象
        const props = Object.entries(schema.properties)
          .map(([k, v]) => {
            const required = schema.required?.includes(k) ? '' : '?'
            return `${k}${required}: ${schemaToTsType(v, config)}`
          })
          .join('; ')
        return `{ ${props} }`
      }
      if (schema.additionalProperties) {
        if (typeof schema.additionalProperties === 'boolean') {
          return 'Record<string, unknown>'
        }
        const valueType = schemaToTsType(schema.additionalProperties, config)
        return `Record<string, ${valueType}>`
      }
      return 'Record<string, unknown>'
    default:
      return 'unknown'
  }
}

/**
 * Parameter 转 TypeScript 类型
 */
function parameterToTsType(param: Parameter): string {
  if (param.enum) {
    return param.enum
      .map(v => typeof v === 'string' ? `'${v}'` : v)
      .join(' | ')
  }

  switch (param.type) {
    case 'string':
      return 'string'
    case 'integer':
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'array':
      if (param.items) {
        // 简单处理数组
        return 'string[]'
      }
      return 'unknown[]'
    default:
      return 'unknown'
  }
}
