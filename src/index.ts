/**
 * swagger2ts-codegen 主入口
 * 导出核心功能供编程使用
 */

export * from './types'
export { loadConfig, validateConfig } from './core/config'
export { loadSwagger, parseSwagger } from './core/parser'
export { generateTypesFile, generateTypeDefinition } from './generators/typeGenerator'
export { generateApiFile, mergeWithExisting } from './generators/apiGenerator'
export { runCheck } from './commands/check'
export { runUpdate } from './commands/update'
