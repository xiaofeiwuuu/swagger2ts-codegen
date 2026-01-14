/**
 * update 命令 - 更新/生成 API 文件
 */

import * as fs from 'fs'
import * as path from 'path'
import { Config, ParsedAPI, ParsedType } from '../types'
import { loadSwagger, parseSwagger } from '../core/parser'
import { generateTypesFile } from '../generators/typeGenerator'
import { generateApiFile, mergeWithExisting } from '../generators/apiGenerator'
import {
  extractAllTags,
  updateTagMapping,
  TAG_MAPPING_FILE
} from '../core/tagMapping'

export interface UpdateOptions {
  clean?: boolean
  initOnly?: boolean
}

/**
 * 执行 update 命令
 */
export async function runUpdate(config: Config, options: UpdateOptions = {}): Promise<void> {
  console.log('正在加载 Swagger 规范...')
  const spec = await loadSwagger(config.input)

  // 确保输出目录存在
  ensureDir(config.output)

  // 检查是否在 package.json 中配置了 tagMapping
  const hasConfigMapping = Object.keys(config.tagMapping).length > 0

  // 提取所有 tags 并更新映射
  const allTags = extractAllTags(spec.paths)
  const { newTags, mapping } = updateTagMapping(config.output, allTags, config.tagMapping)

  if (newTags.length > 0) {
    console.log(`\n发现 ${newTags.length} 个未映射的 tag:`)
    for (const tag of newTags) {
      console.log(`  - ${tag}`)
    }
    if (hasConfigMapping) {
      console.log(`\n请在 package.json 的 swagger-typegen.tagMapping 中添加映射`)
      console.log('示例: "tagMapping": { "包厅": "room", "管理员": "admin" }\n')
    } else {
      console.log(`\n请编辑 ${config.output}/${TAG_MAPPING_FILE} 修改映射后重新运行`)
      console.log('或在 package.json 的 swagger-typegen.tagMapping 中配置（推荐）\n')
    }
  }

  // 如果只是初始化映射文件，到这里就结束
  if (options.initOnly) {
    if (hasConfigMapping) {
      console.log('\n已从 package.json 加载 tagMapping 配置')
    } else {
      console.log(`\n映射文件已生成: ${config.output}/${TAG_MAPPING_FILE}`)
    }
    console.log('请编辑映射后运行 swagger-typegen update 生成代码')
    return
  }

  // 使用已经获取的映射（优先 config，其次文件）
  const tagMapping = mapping

  // 如果需要清理，先删除旧目录（保留 tag-mapping.json）
  if (options.clean) {
    console.log('正在清理旧文件...')
    cleanOutputDir(config.output)
  }

  console.log('正在解析 Swagger...')
  const { apis, types } = parseSwagger(spec, config, tagMapping)

  console.log('正在生成文件...')

  // 按模块生成文件
  for (const [moduleName, moduleApis] of apis) {
    const moduleDir = path.join(config.output, moduleName)
    ensureDir(moduleDir)

    // 收集模块相关的类型
    const moduleTypes = collectModuleTypes(moduleApis, types, config)

    // 生成 types.ts
    generateModuleTypes(moduleDir, moduleTypes, moduleApis, config)

    // 生成 index.ts (API 函数)
    generateModuleApi(moduleDir, moduleApis, config)

    console.log(`  - ${moduleName}/`)
  }

  console.log('')
  console.log(`生成完成！输出目录: ${config.output}`)
}

/**
 * 清理输出目录（保留 tag-mapping.json）
 */
function cleanOutputDir(outputDir: string): void {
  if (!fs.existsSync(outputDir)) return

  const entries = fs.readdirSync(outputDir)
  for (const entry of entries) {
    // 保留 tag-mapping.json
    if (entry === TAG_MAPPING_FILE) continue

    const fullPath = path.join(outputDir, entry)
    const stat = fs.statSync(fullPath)

    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true })
    } else {
      fs.unlinkSync(fullPath)
    }
  }
}

/**
 * 确保目录存在
 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * 收集模块相关的类型
 */
function collectModuleTypes(
  apis: ParsedAPI[],
  allTypes: Map<string, ParsedType[]>,
  config: Config
): ParsedType[] {
  const neededTypes = new Set<string>()

  // 收集 API 使用到的类型名
  for (const api of apis) {
    if (api.bodyTypeName) neededTypes.add(api.bodyTypeName)
    if (api.responseTypeName) neededTypes.add(api.responseTypeName)
  }

  // 从所有类型中找到需要的
  const result: ParsedType[] = []
  const processedNames = new Set<string>()

  for (const [, moduleTypes] of allTypes) {
    for (const type of moduleTypes) {
      if (neededTypes.has(type.name) && !processedNames.has(type.name)) {
        result.push(type)
        processedNames.add(type.name)

        // 递归收集依赖的类型
        collectDependentTypes(type, allTypes, result, processedNames, config)
      }
    }
  }

  return result
}

/**
 * 递归收集依赖的类型
 */
function collectDependentTypes(
  type: ParsedType,
  allTypes: Map<string, ParsedType[]>,
  result: ParsedType[],
  processedNames: Set<string>,
  config: Config
): void {
  const refs = extractTypeRefs(type.schema, config)

  for (const refName of refs) {
    if (processedNames.has(refName)) continue

    // 查找这个类型
    for (const [, moduleTypes] of allTypes) {
      for (const t of moduleTypes) {
        if (t.name === refName && !processedNames.has(t.name)) {
          result.push(t)
          processedNames.add(t.name)
          collectDependentTypes(t, allTypes, result, processedNames, config)
        }
      }
    }
  }
}

/**
 * 从 schema 中提取类型引用
 */
function extractTypeRefs(schema: any, config: Config): string[] {
  const refs: string[] = []

  if (schema.$ref) {
    const refName = schema.$ref.replace('#/definitions/', '')
    const cleanName = cleanTypeName(refName, config.typeNameSuffixFilter)
    refs.push(cleanName)
  }

  if (schema.properties) {
    for (const prop of Object.values(schema.properties)) {
      refs.push(...extractTypeRefs(prop, config))
    }
  }

  if (schema.items) {
    refs.push(...extractTypeRefs(schema.items, config))
  }

  if (schema.allOf) {
    for (const item of schema.allOf) {
      refs.push(...extractTypeRefs(item, config))
    }
  }

  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    refs.push(...extractTypeRefs(schema.additionalProperties, config))
  }

  return refs
}

/**
 * 简单的类型名清理（与 naming.ts 中的保持一致）
 */
function cleanTypeName(name: string, suffixes: string[]): string {
  const parts = name.split('.')
  let cleanName = parts[parts.length - 1]

  // 转帕斯卡命名
  cleanName = cleanName
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^(.)/, (_, char) => char.toUpperCase())

  // 去除后缀
  for (const suffix of suffixes) {
    if (cleanName.endsWith(suffix)) {
      cleanName = cleanName.slice(0, -suffix.length)
      break
    }
  }

  return cleanName
}

/**
 * 生成模块类型文件
 */
function generateModuleTypes(
  moduleDir: string,
  types: ParsedType[],
  apis: ParsedAPI[],
  config: Config
): void {
  const typesPath = path.join(moduleDir, 'types.ts')
  const content = generateTypesFile(types, apis, config)

  // 类型文件直接覆盖（不需要智能合并，因为类型都是自动生成的）
  fs.writeFileSync(typesPath, content, 'utf-8')
}

/**
 * 生成模块 API 文件
 */
function generateModuleApi(
  moduleDir: string,
  apis: ParsedAPI[],
  config: Config
): void {
  const apiPath = path.join(moduleDir, 'index.ts')
  const newContent = generateApiFile(apis, './types', config)

  if (fs.existsSync(apiPath)) {
    // 智能合并：保留自动生成区域外的代码
    const existingContent = fs.readFileSync(apiPath, 'utf-8')
    const mergedContent = mergeWithExisting(existingContent, newContent)
    fs.writeFileSync(apiPath, mergedContent, 'utf-8')
  } else {
    // 新文件直接写入
    fs.writeFileSync(apiPath, newContent, 'utf-8')
  }
}
