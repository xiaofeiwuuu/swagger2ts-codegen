/**
 * swagger-typegen 类型定义
 */

// 请求风格
export type RequestStyle = 'chain' | 'object'

// Tag 映射类型（原始 tag 名 -> 目录名）
export type TagMapping = Record<string, string>

// 配置接口
export interface Config {
  // Swagger 输入源：本地文件路径或远程 URL
  input: string
  // 输出目录
  output: string
  // 请求风格: chain = requestClient.get() / object = service({ method: 'get' })
  requestStyle: RequestStyle
  // 请求客户端名称
  requestClient: string
  // 请求客户端导入路径
  requestImport: string
  // 路径前缀过滤（按顺序匹配，优先匹配长的）
  pathPrefixFilter: string[]
  // 类型名后缀过滤
  typeNameSuffixFilter: string[]
  // 排除的字段名（这些字段会在请求拦截器中自动注入，不需要用户传递）
  excludeFields: string[]
  // 响应解包字段名（如 "data"，表示实际返回的是 response.data，设为 null 则不解包）
  unwrapResponseField: string | null
  // Tag 名称到目录名的映射（如 { "包厅": "room", "管理员": "admin" }）
  tagMapping: TagMapping
  // 只包含指定的 tag（白名单模式，为空数组则不过滤）
  includeTags: string[]
  // 排除指定的 tag（黑名单模式，为空数组则不过滤）
  excludeTags: string[]
}

// 默认配置
export const defaultConfig: Config = {
  input: './swagger.json',
  output: './src/api',
  requestStyle: 'chain',
  requestClient: 'requestClient',
  requestImport: '@/utils/request',
  pathPrefixFilter: ['/api/v1', '/api'],
  typeNameSuffixFilter: ['Request', 'Response'],
  excludeFields: [],
  unwrapResponseField: 'data',
  tagMapping: {},
  includeTags: [],
  excludeTags: []
}

// Swagger 2.0 类型定义
export interface SwaggerSpec {
  swagger: string
  info: {
    title: string
    description?: string
    version: string
  }
  host?: string
  basePath?: string
  schemes?: string[]
  paths: Record<string, PathItem>
  definitions?: Record<string, SchemaObject>
  tags?: Array<{ name: string; description?: string }>
}

// OpenAPI 3.0 类型定义
export interface OpenAPI3Spec {
  openapi: string
  info: {
    title: string
    description?: string
    version: string
    contact?: Record<string, unknown>
  }
  servers?: Array<{ url: string; description?: string }>
  paths: Record<string, OpenAPI3PathItem>
  components?: {
    schemas?: Record<string, SchemaObject>
    securitySchemes?: Record<string, unknown>
  }
  tags?: Array<{ name: string; description?: string }>
}

export interface OpenAPI3PathItem {
  get?: OpenAPI3Operation
  post?: OpenAPI3Operation
  put?: OpenAPI3Operation
  delete?: OpenAPI3Operation
  patch?: OpenAPI3Operation
  options?: OpenAPI3Operation
  head?: OpenAPI3Operation
  parameters?: OpenAPI3Parameter[]
}

export interface OpenAPI3Operation {
  tags?: string[]
  summary?: string
  description?: string
  operationId?: string
  parameters?: OpenAPI3Parameter[]
  requestBody?: OpenAPI3RequestBody
  responses: Record<string, OpenAPI3Response>
  security?: Array<Record<string, string[]>>
}

export interface OpenAPI3Parameter {
  name: string
  in: 'query' | 'header' | 'path' | 'cookie'
  description?: string
  required?: boolean
  schema?: SchemaObject
  style?: string
  explode?: boolean
}

export interface OpenAPI3RequestBody {
  description?: string
  required?: boolean
  content: Record<string, OpenAPI3MediaType>
}

export interface OpenAPI3Response {
  description: string
  content?: Record<string, OpenAPI3MediaType>
}

export interface OpenAPI3MediaType {
  schema?: SchemaObject
  example?: unknown
}

// 通用 API 规范（兼容 Swagger 2.0 和 OpenAPI 3.0）
export type APISpec = SwaggerSpec | OpenAPI3Spec

// 判断是否为 OpenAPI 3.0
export function isOpenAPI3(spec: APISpec): spec is OpenAPI3Spec {
  return 'openapi' in spec && spec.openapi.startsWith('3.')
}

export interface PathItem {
  get?: Operation
  post?: Operation
  put?: Operation
  delete?: Operation
  patch?: Operation
  options?: Operation
  head?: Operation
}

export interface Operation {
  tags?: string[]
  summary?: string
  description?: string
  operationId?: string
  consumes?: string[]
  produces?: string[]
  parameters?: Parameter[]
  responses: Record<string, ResponseObject>
  security?: Array<Record<string, string[]>>
}

export interface Parameter {
  name: string
  in: 'query' | 'header' | 'path' | 'formData' | 'body'
  description?: string
  required?: boolean
  type?: string
  format?: string
  schema?: SchemaObject
  items?: SchemaObject
  enum?: (string | number)[]
  default?: unknown
  minimum?: number
  maximum?: number
  example?: unknown
}

export interface ResponseObject {
  description: string
  schema?: SchemaObject
}

export interface SchemaObject {
  $ref?: string
  type?: string
  format?: string
  description?: string
  properties?: Record<string, SchemaObject>
  items?: SchemaObject
  required?: string[]
  enum?: (string | number)[]
  allOf?: SchemaObject[]
  additionalProperties?: boolean | SchemaObject
  example?: unknown
}

// 解析后的 API 信息
export interface ParsedAPI {
  // 原始路径
  path: string
  // 处理后的路径（去掉前缀）
  cleanPath: string
  // HTTP 方法
  method: string
  // 所属 tag
  tag: string
  // 函数名
  functionName: string
  // 摘要描述
  summary?: string
  // 请求参数类型名
  paramsTypeName?: string
  // 请求体类型名
  bodyTypeName?: string
  // 响应类型名
  responseTypeName?: string
  // 路径参数
  pathParams: Parameter[]
  // 查询参数
  queryParams: Parameter[]
  // 请求体 schema
  bodySchema?: SchemaObject
  // 响应 schema
  responseSchema?: SchemaObject
}

// 解析后的类型信息
export interface ParsedType {
  // 原始名称
  originalName: string
  // 处理后的名称（驼峰 + 去后缀）
  name: string
  // schema 定义
  schema: SchemaObject
  // 生成的 TypeScript 代码
  tsCode?: string
}

// 变更类型
export type ChangeType = 'added' | 'removed' | 'modified'

// 字段变更
export interface FieldChange {
  field: string
  changeType: ChangeType
  oldType?: string
  newType?: string
  description?: string
}

// 类型变更
export interface TypeChange {
  typeName: string
  changeType: ChangeType
  fields: FieldChange[]
}

// API 变更
export interface APIChange {
  path: string
  method: string
  changeType: ChangeType
  functionName: string
}

// 模块变更报告
export interface ModuleChangeReport {
  moduleName: string
  typeChanges: TypeChange[]
  apiChanges: APIChange[]
}

// 完整变更报告
export interface ChangeReport {
  generatedAt: string
  modules: ModuleChangeReport[]
}
