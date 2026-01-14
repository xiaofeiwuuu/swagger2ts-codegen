/**
 * Tag 映射管理模块
 * 用于将 Swagger 中的 tag（如中文）映射为目录名（如英文）
 *
 * 映射优先级：
 * 1. package.json 中的 tagMapping 配置（推荐，不会因删除输出目录而丢失）
 * 2. 输出目录中的 tag-mapping.json 文件（向后兼容）
 */

import * as fs from 'fs'
import * as path from 'path'
import { TagMapping as ConfigTagMapping } from '../types'

// 映射文件名（向后兼容）
export const TAG_MAPPING_FILE = 'tag-mapping.json'

// 重新导出 TagMapping 类型
export type TagMapping = ConfigTagMapping

/**
 * 加载 tag 映射（优先从 config，其次从文件）
 */
export function loadTagMapping(outputDir: string, configMapping: TagMapping = {}): TagMapping {
  // 优先使用 config 中的映射
  if (Object.keys(configMapping).length > 0) {
    return configMapping
  }

  // 向后兼容：从文件加载
  return loadTagMappingFromFile(outputDir)
}

/**
 * 从文件加载 tag 映射（向后兼容）
 */
export function loadTagMappingFromFile(outputDir: string): TagMapping {
  const mappingPath = path.join(outputDir, TAG_MAPPING_FILE)

  if (!fs.existsSync(mappingPath)) {
    return {}
  }

  try {
    const content = fs.readFileSync(mappingPath, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    console.warn(`警告: 解析 ${TAG_MAPPING_FILE} 失败，使用空映射`)
    return {}
  }
}

/**
 * 保存 tag 映射
 */
export function saveTagMapping(outputDir: string, mapping: TagMapping): void {
  const mappingPath = path.join(outputDir, TAG_MAPPING_FILE)
  const content = JSON.stringify(mapping, null, 2)
  fs.writeFileSync(mappingPath, content, 'utf-8')
}

/**
 * 更新 tag 映射（添加新的 tag，保留已有映射）
 * 返回更新后的映射和新增的 tag 列表
 *
 * @param outputDir 输出目录
 * @param tags Swagger 中的所有 tag
 * @param configMapping 从 package.json 配置中读取的映射
 */
export function updateTagMapping(
  outputDir: string,
  tags: string[],
  configMapping: TagMapping = {}
): { mapping: TagMapping; newTags: string[] } {
  // 如果配置中有映射，优先使用配置，同时检测未映射的新 tag
  const hasConfigMapping = Object.keys(configMapping).length > 0

  // 合并现有映射：优先 config，其次文件
  const existingMapping = hasConfigMapping
    ? { ...configMapping }
    : loadTagMappingFromFile(outputDir)

  const newTags: string[] = []

  for (const tag of tags) {
    if (!(tag in existingMapping)) {
      // 新 tag，默认映射为自身
      existingMapping[tag] = tag
      newTags.push(tag)
    }
  }

  // 只有在没有使用 config 映射时才写入文件
  if (!hasConfigMapping && newTags.length > 0) {
    saveTagMapping(outputDir, existingMapping)
  }

  return { mapping: existingMapping, newTags }
}

/**
 * 应用 tag 映射，获取目录名
 */
export function applyTagMapping(tag: string, mapping: TagMapping): string {
  return mapping[tag] || tag
}

/**
 * 从 Swagger 规范中提取所有 tags
 */
export function extractAllTags(paths: Record<string, any>): string[] {
  const tags = new Set<string>()

  for (const pathItem of Object.values(paths)) {
    const methods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head']
    for (const method of methods) {
      const operation = pathItem[method]
      if (operation?.tags?.[0]) {
        tags.add(operation.tags[0])
      }
    }
  }

  return [...tags].sort()
}
