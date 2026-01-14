/**
 * API 函数生成器
 */

import { ParsedAPI, Config } from '../types'

// 自动生成代码的标记
export const AUTO_GEN_START = '// --- AUTO GENERATED START ---'
export const AUTO_GEN_END = '// --- AUTO GENERATED END ---'

/**
 * 生成 API 函数文件内容
 */
export function generateApiFile(
  apis: ParsedAPI[],
  typesImportPath: string,
  config: Config
): string {
  const lines: string[] = []

  lines.push('/**')
  lines.push(' * 此文件由 swagger-typegen 自动生成')
  lines.push(' * 自动生成的代码在 AUTO GENERATED 标记之间')
  lines.push(' * 标记之外的代码不会被覆盖')
  lines.push(' */')
  lines.push('')

  // 生成导入语句
  lines.push(generateImports(apis, typesImportPath, config))
  lines.push('')

  // 自动生成区域开始
  lines.push(AUTO_GEN_START)
  lines.push('')

  // 生成每个 API 函数
  for (const api of apis) {
    const funcCode = generateApiFunction(api, config)
    lines.push(funcCode)
    lines.push('')
  }

  // 自动生成区域结束
  lines.push(AUTO_GEN_END)
  lines.push('')

  return lines.join('\n')
}

// TypeScript 内置类型，不需要导入
const BUILTIN_TYPES = new Set([
  'unknown', 'any', 'void', 'never', 'string', 'number', 'boolean',
  'null', 'undefined', 'object', 'symbol', 'bigint',
  'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Array'
])

/**
 * 生成导入语句
 */
function generateImports(
  apis: ParsedAPI[],
  typesImportPath: string,
  config: Config
): string {
  const lines: string[] = []

  // 导入请求客户端
  lines.push(`import { ${config.requestClient} } from '${config.requestImport}'`)

  // 收集需要导入的类型（过滤掉内置类型）
  const typeNames = new Set<string>()
  for (const api of apis) {
    if (api.paramsTypeName) {
      const baseName = extractBaseTypeName(api.paramsTypeName)
      if (!BUILTIN_TYPES.has(baseName)) {
        typeNames.add(baseName)
      }
    }
    if (api.bodyTypeName) {
      const baseName = extractBaseTypeName(api.bodyTypeName)
      if (!BUILTIN_TYPES.has(baseName)) {
        typeNames.add(baseName)
      }
    }
    if (api.responseTypeName) {
      const baseName = extractBaseTypeName(api.responseTypeName)
      if (!BUILTIN_TYPES.has(baseName)) {
        typeNames.add(baseName)
      }
    }
  }

  if (typeNames.size > 0) {
    const typeImports = [...typeNames].sort().join(', ')
    lines.push(`import type { ${typeImports} } from '${typesImportPath}'`)
  }

  return lines.join('\n')
}

/**
 * 从类型名中提取基础类型名（去掉数组后缀等）
 * User[] -> User
 * Record<string, User> -> 保持原样（复杂泛型不处理）
 */
function extractBaseTypeName(typeName: string): string {
  // 去掉数组后缀 []
  return typeName.replace(/\[\]$/, '')
}

/**
 * 生成单个 API 函数
 */
function generateApiFunction(api: ParsedAPI, config: Config): string {
  const lines: string[] = []

  // 添加 JSDoc 注释
  if (api.summary) {
    lines.push(`/** ${api.summary} */`)
  }

  // 构建函数参数
  const params = buildFunctionParams(api)

  // 构建返回类型
  const returnType = api.responseTypeName || 'unknown'

  if (config.requestStyle === 'chain') {
    lines.push(generateChainStyleFunction(api, params, returnType, config))
  } else {
    lines.push(generateObjectStyleFunction(api, params, returnType, config))
  }

  return lines.join('\n')
}

/**
 * 构建函数参数
 */
function buildFunctionParams(api: ParsedAPI): string[] {
  const params: string[] = []

  // 路径参数
  for (const pathParam of api.pathParams) {
    const tsType = pathParam.type === 'integer' ? 'number' : (pathParam.type || 'string')
    params.push(`${pathParam.name}: ${tsType}`)
  }

  // 请求体参数
  if (api.bodyTypeName) {
    params.push(`data: ${api.bodyTypeName}`)
  }

  // 查询参数
  if (api.paramsTypeName) {
    params.push(`params: ${api.paramsTypeName}`)
  }

  return params
}

/**
 * 生成链式调用风格的函数
 * requestClient.get<T>('/path', { params })
 * requestClient.post<T>('/path', data)
 */
function generateChainStyleFunction(
  api: ParsedAPI,
  params: string[],
  returnType: string,
  config: Config
): string {
  const funcParams = params.join(', ')
  const method = api.method.toLowerCase()

  // 构建请求路径（处理路径参数）
  let requestPath = api.cleanPath
  for (const pathParam of api.pathParams) {
    // 同时处理 {id} 和 :id 两种格式
    requestPath = requestPath.replace(`{${pathParam.name}}`, `\${${pathParam.name}}`)
    requestPath = requestPath.replace(`:${pathParam.name}`, `\${${pathParam.name}}`)
  }

  // 使用模板字符串或普通字符串
  const pathString = api.pathParams.length > 0 ? `\`${requestPath}\`` : `'${requestPath}'`

  // 构建请求参数
  let requestArgs = pathString
  if (method === 'get' || method === 'delete') {
    if (api.paramsTypeName) {
      requestArgs += ', { params }'
    }
  } else {
    if (api.bodyTypeName) {
      requestArgs += ', data'
    }
    if (api.paramsTypeName) {
      requestArgs += ', { params }'
    }
  }

  return `export const ${api.functionName} = (${funcParams}) => {
  return ${config.requestClient}.${method}<${returnType}>(${requestArgs})
}`
}

/**
 * 生成配置对象风格的函数
 * service({ url: '/path', method: 'post', data })
 */
function generateObjectStyleFunction(
  api: ParsedAPI,
  params: string[],
  returnType: string,
  config: Config
): string {
  const funcParams = params.join(', ')
  const method = api.method.toLowerCase()

  // 构建请求路径（处理路径参数）
  let requestPath = api.cleanPath
  for (const pathParam of api.pathParams) {
    // 同时处理 {id} 和 :id 两种格式
    requestPath = requestPath.replace(`{${pathParam.name}}`, `\${${pathParam.name}}`)
    requestPath = requestPath.replace(`:${pathParam.name}`, `\${${pathParam.name}}`)
  }

  // 使用模板字符串或普通字符串
  const pathString = api.pathParams.length > 0 ? `\`${requestPath}\`` : `'${requestPath}'`

  // 构建配置对象
  const configLines: string[] = [
    `    url: ${pathString}`,
    `    method: '${method}'`
  ]

  if (api.bodyTypeName) {
    configLines.push('    data')
  }

  if (api.paramsTypeName) {
    configLines.push('    params')
  }

  const configStr = configLines.join(',\n')

  return `export const ${api.functionName} = (${funcParams}) => {
  return ${config.requestClient}<${returnType}>({
${configStr}
  })
}`
}

/**
 * 合并生成的代码和现有代码
 * 保留 AUTO GENERATED 标记之外的代码
 */
export function mergeWithExisting(existingContent: string, newContent: string): string {
  // 查找现有文件中的自动生成区域
  const existingStartIndex = existingContent.indexOf(AUTO_GEN_START)
  const existingEndIndex = existingContent.indexOf(AUTO_GEN_END)

  // 如果现有文件没有标记，直接返回新内容
  if (existingStartIndex === -1 || existingEndIndex === -1) {
    return newContent
  }

  // 提取新内容中的自动生成部分
  const newStartIndex = newContent.indexOf(AUTO_GEN_START)
  const newEndIndex = newContent.indexOf(AUTO_GEN_END)

  if (newStartIndex === -1 || newEndIndex === -1) {
    return newContent
  }

  const newAutoGenPart = newContent.slice(newStartIndex, newEndIndex + AUTO_GEN_END.length)

  // 保留现有文件的前后部分，替换中间的自动生成部分
  const beforeAutoGen = existingContent.slice(0, existingStartIndex)
  const afterAutoGen = existingContent.slice(existingEndIndex + AUTO_GEN_END.length)

  return beforeAutoGen + newAutoGenPart + afterAutoGen
}

/**
 * 从现有文件中提取自动生成的 API 信息
 */
export function extractExistingApis(content: string): Map<string, string> {
  const apis = new Map<string, string>()

  // 匹配 export const funcName =
  const funcRegex = /export const (\w+) = \([^)]*\) => \{[\s\S]*?\n\}/g
  let match

  while ((match = funcRegex.exec(content)) !== null) {
    const funcName = match[1]
    const funcBody = match[0]
    apis.set(funcName, funcBody)
  }

  return apis
}
