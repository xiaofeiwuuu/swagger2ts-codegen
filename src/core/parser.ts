/**
 * Swagger/OpenAPI 解析器
 * 支持 Swagger 2.0 和 OpenAPI 3.0
 */

import * as fs from 'fs'
import * as https from 'https'
import * as http from 'http'
import {
  Config,
  SwaggerSpec,
  OpenAPI3Spec,
  OpenAPI3Operation,
  OpenAPI3Parameter,
  APISpec,
  isOpenAPI3,
  ParsedAPI,
  ParsedType,
  SchemaObject,
  Operation,
  Parameter
} from '../types'
import {
  cleanTypeName,
  generateFunctionName,
  cleanPathPrefix,
  tagToDirectoryName,
  toPascalCase
} from '../utils/naming'
import { TagMapping, applyTagMapping } from './tagMapping'

/**
 * 加载 Swagger/OpenAPI 规范
 */
export async function loadSwagger(input: string): Promise<APISpec> {
  // 判断是 URL 还是本地文件
  if (input.startsWith('http://') || input.startsWith('https://')) {
    return fetchSwagger(input)
  } else {
    return loadSwaggerFromFile(input)
  }
}

/**
 * 从本地文件加载
 */
function loadSwaggerFromFile(filePath: string): APISpec {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Swagger/OpenAPI 文件不存在: ${filePath}`)
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(content)
}

/**
 * 从远程 URL 获取
 */
function fetchSwagger(url: string): Promise<APISpec> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https://') ? https : http

    client.get(url, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (error) {
          reject(new Error(`解析 Swagger/OpenAPI JSON 失败: ${error}`))
        }
      })
    }).on('error', (error) => {
      reject(new Error(`获取 Swagger/OpenAPI 失败: ${error.message}`))
    })
  })
}

/**
 * 解析 Swagger/OpenAPI 规范
 * @param spec Swagger 2.0 或 OpenAPI 3.0 规范
 * @param config 配置
 * @param tagMapping tag 映射（可选，用于将原始 tag 名映射为目录名）
 */
export function parseSwagger(
  spec: APISpec,
  config: Config,
  tagMapping: TagMapping = {}
): { apis: Map<string, ParsedAPI[]>; types: Map<string, ParsedType[]> } {
  // 检测版本并分发到对应解析器
  if (isOpenAPI3(spec)) {
    return parseOpenAPI3(spec, config, tagMapping)
  } else {
    return parseSwagger2(spec as SwaggerSpec, config, tagMapping)
  }
}

/**
 * 检查 tag 是否应该被包含
 */
function shouldIncludeTag(originalTag: string, config: Config): boolean {
  // 如果设置了 includeTags（白名单），只包含列表中的 tag
  if (config.includeTags.length > 0) {
    return config.includeTags.includes(originalTag)
  }

  // 如果设置了 excludeTags（黑名单），排除列表中的 tag
  if (config.excludeTags.length > 0) {
    return !config.excludeTags.includes(originalTag)
  }

  // 默认包含所有 tag
  return true
}

/**
 * 解析 Swagger 2.0 规范
 */
function parseSwagger2(
  spec: SwaggerSpec,
  config: Config,
  tagMapping: TagMapping = {}
): { apis: Map<string, ParsedAPI[]>; types: Map<string, ParsedType[]> } {
  const apis = new Map<string, ParsedAPI[]>()
  const types = new Map<string, ParsedType[]>()

  // 收集所有使用到的类型引用
  const usedRefs = new Set<string>()

  // 解析所有 API
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const methods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'] as const

    for (const method of methods) {
      const operation = pathItem[method]
      if (!operation) continue

      // 获取原始 tag 名称，检查是否应该包含
      const originalTag = operation.tags?.[0] || 'default'
      if (!shouldIncludeTag(originalTag, config)) {
        continue
      }

      const parsedAPI = parseOperation(path, method, operation, config, usedRefs, spec.definitions || {}, tagMapping)

      // 按 tag 分组
      const tag = parsedAPI.tag
      if (!apis.has(tag)) {
        apis.set(tag, [])
      }
      apis.get(tag)!.push(parsedAPI)
    }
  }

  // 解析使用到的类型定义
  if (spec.definitions) {
    const processedRefs = new Set<string>()
    const refsToProcess = [...usedRefs]

    // 递归收集所有依赖的类型
    while (refsToProcess.length > 0) {
      const ref = refsToProcess.pop()!
      if (processedRefs.has(ref)) continue
      processedRefs.add(ref)

      const refName = ref.replace('#/definitions/', '')
      const schema = spec.definitions[refName]
      if (!schema) continue

      // 收集这个类型内部引用的其他类型
      collectRefs(schema, refsToProcess)
    }

    // 解析所有收集到的类型
    for (const ref of processedRefs) {
      const refName = ref.replace('#/definitions/', '')
      const schema = spec.definitions[refName]
      if (!schema) continue

      const parsedType = parseType(refName, schema, config)

      // 按模块分组（这里简化处理，根据类型名前缀分组）
      const moduleName = getModuleFromTypeName(refName)
      if (!types.has(moduleName)) {
        types.set(moduleName, [])
      }
      types.get(moduleName)!.push(parsedType)
    }
  }

  return { apis, types }
}

/**
 * 解析 OpenAPI 3.0 规范
 */
function parseOpenAPI3(
  spec: OpenAPI3Spec,
  config: Config,
  tagMapping: TagMapping = {}
): { apis: Map<string, ParsedAPI[]>; types: Map<string, ParsedType[]> } {
  const apis = new Map<string, ParsedAPI[]>()
  const types = new Map<string, ParsedType[]>()

  // 收集所有使用到的类型引用
  const usedRefs = new Set<string>()

  const schemas = spec.components?.schemas || {}

  // 解析所有 API
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const methods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'] as const

    for (const method of methods) {
      const operation = pathItem[method]
      if (!operation) continue

      // 获取原始 tag 名称，检查是否应该包含
      const originalTag = operation.tags?.[0] || 'default'
      if (!shouldIncludeTag(originalTag, config)) {
        continue
      }

      const parsedAPI = parseOpenAPI3Operation(path, method, operation, config, usedRefs, schemas, tagMapping)

      // 按 tag 分组
      const tag = parsedAPI.tag
      if (!apis.has(tag)) {
        apis.set(tag, [])
      }
      apis.get(tag)!.push(parsedAPI)
    }
  }

  // 解析使用到的类型定义
  if (schemas) {
    const processedRefs = new Set<string>()
    const refsToProcess = [...usedRefs]

    // 递归收集所有依赖的类型
    while (refsToProcess.length > 0) {
      const ref = refsToProcess.pop()!
      if (processedRefs.has(ref)) continue
      processedRefs.add(ref)

      const refName = ref.replace('#/components/schemas/', '')
      const schema = schemas[refName]
      if (!schema) continue

      // 收集这个类型内部引用的其他类型（OpenAPI 3.0 使用 #/components/schemas/）
      collectRefs(schema, refsToProcess, true)
    }

    // 解析所有收集到的类型
    for (const ref of processedRefs) {
      const refName = ref.replace('#/components/schemas/', '')
      const schema = schemas[refName]
      if (!schema) continue

      const parsedType = parseType(refName, schema, config)

      // 按模块分组
      const moduleName = getModuleFromTypeName(refName)
      if (!types.has(moduleName)) {
        types.set(moduleName, [])
      }
      types.get(moduleName)!.push(parsedType)
    }
  }

  return { apis, types }
}

/**
 * 解析单个 API 操作
 */
function parseOperation(
  path: string,
  method: string,
  operation: Operation,
  config: Config,
  usedRefs: Set<string>,
  definitions: Record<string, SchemaObject>,
  tagMapping: TagMapping = {}
): ParsedAPI {
  const originalTag = operation.tags?.[0] || 'default'
  // 先应用映射，再转换为目录名格式
  const mappedTag = applyTagMapping(originalTag, tagMapping)
  const tag = tagToDirectoryName(mappedTag)
  const cleanPath = cleanPathPrefix(path, config.pathPrefixFilter)
  const functionName = generateFunctionName(method, cleanPath)

  const pathParams: Parameter[] = []
  const queryParams: Parameter[] = []
  let bodySchema: SchemaObject | undefined
  let bodyTypeName: string | undefined
  let paramsTypeName: string | undefined

  // 解析参数
  if (operation.parameters) {
    for (const param of operation.parameters) {
      if (param.in === 'path') {
        pathParams.push(param)
      } else if (param.in === 'query') {
        queryParams.push(param)
      } else if (param.in === 'body' && param.schema) {
        bodySchema = param.schema
        if (param.schema.$ref) {
          usedRefs.add(param.schema.$ref)
          bodyTypeName = cleanTypeName(
            param.schema.$ref.replace('#/definitions/', ''),
            config.typeNameSuffixFilter
          )
        }
      }
    }
  }

  // 如果有 query 参数，生成参数类型名
  if (queryParams.length > 0) {
    paramsTypeName = toPascalCase(functionName) + 'Params'
  }

  // 解析响应
  let responseSchema: SchemaObject | undefined
  let responseTypeName: string | undefined

  const successResponse = operation.responses['200'] || operation.responses['201']
  if (successResponse?.schema) {
    responseSchema = successResponse.schema
    const unwrapField = config.unwrapResponseField

    // 处理 allOf
    if (responseSchema.allOf) {
      for (const item of responseSchema.allOf) {
        if (item.$ref) {
          usedRefs.add(item.$ref)
        }
        // 如果配置了解包字段，查找该字段的类型
        if (unwrapField && item.properties?.[unwrapField]) {
          const dataSchema = item.properties[unwrapField]
          if (dataSchema.$ref) {
            usedRefs.add(dataSchema.$ref)
            responseTypeName = cleanTypeName(
              dataSchema.$ref.replace('#/definitions/', ''),
              config.typeNameSuffixFilter
            )
          } else if (dataSchema.type) {
            // 处理内联类型 (如 data: unknown)
            responseTypeName = schemaTypeToTs(dataSchema)
          }
        }
      }
    } else if (responseSchema.$ref) {
      usedRefs.add(responseSchema.$ref)
      // 如果配置了解包，需要解析引用的类型并提取 data 字段
      if (unwrapField) {
        responseTypeName = extractUnwrappedType(
          responseSchema.$ref,
          unwrapField,
          definitions,
          config,
          usedRefs
        )
      } else {
        responseTypeName = cleanTypeName(
          responseSchema.$ref.replace('#/definitions/', ''),
          config.typeNameSuffixFilter
        )
      }
    } else if (responseSchema.properties && unwrapField) {
      // 直接定义了 properties
      const dataSchema = responseSchema.properties[unwrapField]
      if (dataSchema?.$ref) {
        usedRefs.add(dataSchema.$ref)
        responseTypeName = cleanTypeName(
          dataSchema.$ref.replace('#/definitions/', ''),
          config.typeNameSuffixFilter
        )
      } else if (dataSchema?.type) {
        responseTypeName = schemaTypeToTs(dataSchema)
      }
    }
  }

  return {
    path,
    cleanPath,
    method,
    tag,
    functionName,
    summary: operation.summary,
    paramsTypeName,
    bodyTypeName,
    responseTypeName,
    pathParams,
    queryParams,
    bodySchema,
    responseSchema
  }
}

/**
 * 解析 OpenAPI 3.0 单个 API 操作
 */
function parseOpenAPI3Operation(
  path: string,
  method: string,
  operation: OpenAPI3Operation,
  config: Config,
  usedRefs: Set<string>,
  schemas: Record<string, SchemaObject>,
  tagMapping: TagMapping = {}
): ParsedAPI {
  const originalTag = operation.tags?.[0] || 'default'
  const mappedTag = applyTagMapping(originalTag, tagMapping)
  const tag = tagToDirectoryName(mappedTag)
  const cleanPath = cleanPathPrefix(path, config.pathPrefixFilter)
  const functionName = generateFunctionName(method, cleanPath)

  const pathParams: Parameter[] = []
  const queryParams: Parameter[] = []
  let bodySchema: SchemaObject | undefined
  let bodyTypeName: string | undefined
  let paramsTypeName: string | undefined

  // 解析参数（OpenAPI 3.0 格式）
  if (operation.parameters) {
    for (const param of operation.parameters) {
      // 转换为内部 Parameter 格式
      const internalParam: Parameter = {
        name: param.name,
        in: param.in as 'query' | 'header' | 'path' | 'formData' | 'body',
        description: param.description,
        required: param.required,
        type: param.schema?.type,
        format: param.schema?.format,
        schema: param.schema
      }

      if (param.in === 'path') {
        pathParams.push(internalParam)
      } else if (param.in === 'query') {
        queryParams.push(internalParam)
      }
    }
  }

  // 解析 requestBody（OpenAPI 3.0 特有）
  if (operation.requestBody?.content) {
    const content = operation.requestBody.content
    const jsonContent = content['application/json'] || content['*/*']
    if (jsonContent?.schema) {
      bodySchema = jsonContent.schema
      if (jsonContent.schema.$ref) {
        usedRefs.add(jsonContent.schema.$ref)
        bodyTypeName = cleanTypeName(
          jsonContent.schema.$ref.replace('#/components/schemas/', ''),
          config.typeNameSuffixFilter
        )
      }
    }
  }

  // 如果有 query 参数，生成参数类型名
  if (queryParams.length > 0) {
    paramsTypeName = toPascalCase(functionName) + 'Params'
  }

  // 解析响应（OpenAPI 3.0 格式）
  let responseSchema: SchemaObject | undefined
  let responseTypeName: string | undefined

  const successResponse = operation.responses['200'] || operation.responses['201']
  if (successResponse?.content) {
    const jsonContent = successResponse.content['application/json'] || successResponse.content['*/*']
    if (jsonContent?.schema) {
      responseSchema = jsonContent.schema
      const unwrapField = config.unwrapResponseField

      // 处理 allOf
      if (responseSchema.allOf) {
        for (const item of responseSchema.allOf) {
          if (item.$ref) {
            usedRefs.add(item.$ref)
          }
          if (unwrapField && item.properties?.[unwrapField]) {
            const dataSchema = item.properties[unwrapField]
            if (dataSchema.$ref) {
              usedRefs.add(dataSchema.$ref)
              responseTypeName = cleanTypeName(
                dataSchema.$ref.replace('#/components/schemas/', ''),
                config.typeNameSuffixFilter
              )
            } else if (dataSchema.type) {
              responseTypeName = schemaTypeToTs3(dataSchema)
            }
          }
        }
      } else if (responseSchema.$ref) {
        usedRefs.add(responseSchema.$ref)
        if (unwrapField) {
          responseTypeName = extractUnwrappedType3(
            responseSchema.$ref,
            unwrapField,
            schemas,
            config,
            usedRefs
          )
        } else {
          responseTypeName = cleanTypeName(
            responseSchema.$ref.replace('#/components/schemas/', ''),
            config.typeNameSuffixFilter
          )
        }
      } else if (responseSchema.properties && unwrapField) {
        const dataSchema = responseSchema.properties[unwrapField]
        if (dataSchema?.$ref) {
          usedRefs.add(dataSchema.$ref)
          responseTypeName = cleanTypeName(
            dataSchema.$ref.replace('#/components/schemas/', ''),
            config.typeNameSuffixFilter
          )
        } else if (dataSchema?.type) {
          responseTypeName = schemaTypeToTs3(dataSchema)
        }
      }
    }
  }

  return {
    path,
    cleanPath,
    method,
    tag,
    functionName,
    summary: operation.summary,
    paramsTypeName,
    bodyTypeName,
    responseTypeName,
    pathParams,
    queryParams,
    bodySchema,
    responseSchema
  }
}

/**
 * 解析类型定义
 */
function parseType(name: string, schema: SchemaObject, config: Config): ParsedType {
  return {
    originalName: name,
    name: cleanTypeName(name, config.typeNameSuffixFilter),
    schema
  }
}

/**
 * 从类型名获取模块名
 */
function getModuleFromTypeName(typeName: string): string {
  const parts = typeName.split('.')
  if (parts.length > 1) {
    return tagToDirectoryName(parts[0])
  }
  return 'common'
}

/**
 * 递归收集 schema 中的 $ref 引用
 * @param isOpenAPI3 是否为 OpenAPI 3.0 格式（使用 #/components/schemas/ 前缀）
 */
function collectRefs(schema: SchemaObject, refs: string[], isOpenAPI3: boolean = false): void {
  if (schema.$ref) {
    // 统一转换为对应版本的引用格式
    refs.push(schema.$ref)
    return
  }

  if (schema.properties) {
    for (const prop of Object.values(schema.properties)) {
      collectRefs(prop, refs, isOpenAPI3)
    }
  }

  if (schema.items) {
    collectRefs(schema.items, refs, isOpenAPI3)
  }

  if (schema.allOf) {
    for (const item of schema.allOf) {
      collectRefs(item, refs, isOpenAPI3)
    }
  }

  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    collectRefs(schema.additionalProperties, refs, isOpenAPI3)
  }
}

/**
 * 从引用类型中提取解包后的类型
 * 例如：响应是 { data: User, message: string }，解包后返回 User
 */
function extractUnwrappedType(
  ref: string,
  unwrapField: string,
  definitions: Record<string, SchemaObject>,
  config: Config,
  usedRefs: Set<string>
): string | undefined {
  const refName = ref.replace('#/definitions/', '')
  const schema = definitions[refName]

  if (!schema) return undefined

  // 查找 unwrapField 字段
  if (schema.properties?.[unwrapField]) {
    const fieldSchema = schema.properties[unwrapField]

    if (fieldSchema.$ref) {
      usedRefs.add(fieldSchema.$ref)
      return cleanTypeName(
        fieldSchema.$ref.replace('#/definitions/', ''),
        config.typeNameSuffixFilter
      )
    }

    // 处理数组类型
    if (fieldSchema.type === 'array' && fieldSchema.items?.$ref) {
      usedRefs.add(fieldSchema.items.$ref)
      const itemType = cleanTypeName(
        fieldSchema.items.$ref.replace('#/definitions/', ''),
        config.typeNameSuffixFilter
      )
      return `${itemType}[]`
    }

    // 处理基本类型
    return schemaTypeToTs(fieldSchema)
  }

  // 如果没找到解包字段，返回原类型
  return cleanTypeName(refName, config.typeNameSuffixFilter)
}

/**
 * 将 schema type 转换为 TypeScript 类型字符串（Swagger 2.0）
 */
function schemaTypeToTs(schema: SchemaObject): string {
  if (schema.$ref) {
    return schema.$ref.replace('#/definitions/', '').split('.').pop() || 'unknown'
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
        return `${schemaTypeToTs(schema.items)}[]`
      }
      return 'unknown[]'
    case 'object':
      return 'Record<string, unknown>'
    default:
      return 'unknown'
  }
}

/**
 * 将 schema type 转换为 TypeScript 类型字符串（OpenAPI 3.0）
 */
function schemaTypeToTs3(schema: SchemaObject): string {
  if (schema.$ref) {
    return schema.$ref.replace('#/components/schemas/', '').split('.').pop() || 'unknown'
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
        return `${schemaTypeToTs3(schema.items)}[]`
      }
      return 'unknown[]'
    case 'object':
      return 'Record<string, unknown>'
    default:
      return 'unknown'
  }
}

/**
 * 从引用类型中提取解包后的类型（OpenAPI 3.0）
 */
function extractUnwrappedType3(
  ref: string,
  unwrapField: string,
  schemas: Record<string, SchemaObject>,
  config: Config,
  usedRefs: Set<string>
): string | undefined {
  const refName = ref.replace('#/components/schemas/', '')
  const schema = schemas[refName]

  if (!schema) return undefined

  // 查找 unwrapField 字段
  if (schema.properties?.[unwrapField]) {
    const fieldSchema = schema.properties[unwrapField]

    if (fieldSchema.$ref) {
      usedRefs.add(fieldSchema.$ref)
      return cleanTypeName(
        fieldSchema.$ref.replace('#/components/schemas/', ''),
        config.typeNameSuffixFilter
      )
    }

    // 处理数组类型
    if (fieldSchema.type === 'array' && fieldSchema.items?.$ref) {
      usedRefs.add(fieldSchema.items.$ref)
      const itemType = cleanTypeName(
        fieldSchema.items.$ref.replace('#/components/schemas/', ''),
        config.typeNameSuffixFilter
      )
      return `${itemType}[]`
    }

    // 处理基本类型
    return schemaTypeToTs3(fieldSchema)
  }

  // 如果没找到解包字段，返回原类型
  return cleanTypeName(refName, config.typeNameSuffixFilter)
}
