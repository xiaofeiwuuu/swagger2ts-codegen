/**
 * 配置加载模块
 */

import * as fs from 'fs'
import * as path from 'path'
import { Config, defaultConfig } from '../types'

/**
 * 从 package.json 加载配置
 */
export function loadConfig(cwd: string = process.cwd()): Config {
  const packageJsonPath = path.join(cwd, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    console.warn('未找到 package.json，使用默认配置')
    return { ...defaultConfig }
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    const userConfig = packageJson['swagger-typegen'] || {}

    // 合并配置，用户配置优先
    const config: Config = {
      ...defaultConfig,
      ...userConfig,
      // 数组类型需要特殊处理，如果用户提供了就完全覆盖
      pathPrefixFilter: userConfig.pathPrefixFilter || defaultConfig.pathPrefixFilter,
      typeNameSuffixFilter: userConfig.typeNameSuffixFilter || defaultConfig.typeNameSuffixFilter,
      excludeFields: userConfig.excludeFields || defaultConfig.excludeFields,
      // unwrapResponseField 可以是 null，需要特殊处理
      unwrapResponseField: userConfig.unwrapResponseField !== undefined
        ? userConfig.unwrapResponseField
        : defaultConfig.unwrapResponseField,
      // tagMapping 对象类型，合并用户配置
      tagMapping: userConfig.tagMapping || defaultConfig.tagMapping,
      // tag 过滤配置
      includeTags: userConfig.includeTags || defaultConfig.includeTags,
      excludeTags: userConfig.excludeTags || defaultConfig.excludeTags
    }

    // 路径前缀按长度降序排列，优先匹配长的
    config.pathPrefixFilter = [...config.pathPrefixFilter].sort((a, b) => b.length - a.length)

    return config
  } catch (error) {
    console.error('解析 package.json 失败:', error)
    return { ...defaultConfig }
  }
}

/**
 * 验证配置
 */
export function validateConfig(config: Config): string[] {
  const errors: string[] = []

  if (!config.input) {
    errors.push('input 配置项不能为空')
  }

  if (!config.output) {
    errors.push('output 配置项不能为空')
  }

  if (!['chain', 'object'].includes(config.requestStyle)) {
    errors.push('requestStyle 必须是 "chain" 或 "object"')
  }

  if (!config.requestClient) {
    errors.push('requestClient 配置项不能为空')
  }

  if (!config.requestImport) {
    errors.push('requestImport 配置项不能为空')
  }

  return errors
}
