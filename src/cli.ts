#!/usr/bin/env node

/**
 * swagger-typegen CLI 入口
 */

import { Command } from 'commander'
import chalk from 'chalk'
import { loadConfig, validateConfig } from './core/config'
import { runCheck } from './commands/check'
import { runUpdate } from './commands/update'

const program = new Command()

program
  .name('swagger-typegen')
  .description('从 Swagger/OpenAPI 规范生成 TypeScript 类型和 API 函数')
  .version('1.0.0')

// check 命令
program
  .command('check')
  .description('检测 Swagger 与现有 API 文件的差异，生成变更报告')
  .action(async () => {
    try {
      console.log(chalk.cyan('swagger-typegen check'))
      console.log('')

      const config = loadConfig()
      const errors = validateConfig(config)

      if (errors.length > 0) {
        console.error(chalk.red('配置错误:'))
        errors.forEach(e => console.error(chalk.red(`  - ${e}`)))
        process.exit(1)
      }

      const report = await runCheck(config)

      // 输出摘要
      console.log('')
      let totalTypeChanges = 0
      let totalApiChanges = 0

      for (const module of report.modules) {
        totalTypeChanges += module.typeChanges.length
        totalApiChanges += module.apiChanges.length
      }

      if (totalTypeChanges === 0 && totalApiChanges === 0) {
        console.log(chalk.green('未检测到任何变更'))
      } else {
        console.log(chalk.yellow(`检测到变更:`))
        console.log(chalk.yellow(`  - 类型变更: ${totalTypeChanges}`))
        console.log(chalk.yellow(`  - API 变更: ${totalApiChanges}`))
      }

    } catch (error) {
      console.error(chalk.red('执行失败:'), error)
      process.exit(1)
    }
  })

// update 命令
program
  .command('update')
  .description('根据 Swagger 规范更新/生成 API 文件')
  .option('--clean', '生成前清空输出目录（保留 tag-mapping.json）')
  .option('--init-only', '仅生成 tag-mapping.json，不生成代码（用于首次配置映射）')
  .action(async (options) => {
    try {
      console.log(chalk.cyan('swagger-typegen update'))
      console.log('')

      const config = loadConfig()
      const errors = validateConfig(config)

      if (errors.length > 0) {
        console.error(chalk.red('配置错误:'))
        errors.forEach(e => console.error(chalk.red(`  - ${e}`)))
        process.exit(1)
      }

      await runUpdate(config, {
        clean: options.clean || false,
        initOnly: options.initOnly || false
      })

      console.log('')
      console.log(chalk.green('更新完成!'))

    } catch (error) {
      console.error(chalk.red('执行失败:'), error)
      process.exit(1)
    }
  })

// init 命令 - 生成示例配置
program
  .command('init')
  .description('在 package.json 中初始化 swagger-typegen 配置')
  .action(async () => {
    const fs = await import('fs')
    const path = await import('path')

    const packageJsonPath = path.join(process.cwd(), 'package.json')

    if (!fs.existsSync(packageJsonPath)) {
      console.error(chalk.red('未找到 package.json'))
      process.exit(1)
    }

    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))

      if (packageJson['swagger-typegen']) {
        console.log(chalk.yellow('swagger-typegen 配置已存在'))
        return
      }

      packageJson['swagger-typegen'] = {
        input: './swagger.json',
        output: './src/api',
        requestStyle: 'chain',
        requestClient: 'requestClient',
        requestImport: '@/utils/request',
        pathPrefixFilter: ['/api/v1', '/api'],
        typeNameSuffixFilter: ['Request', 'Response']
      }

      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8')

      console.log(chalk.green('配置已添加到 package.json'))
      console.log('')
      console.log('请根据你的项目修改以下配置:')
      console.log(chalk.cyan(JSON.stringify(packageJson['swagger-typegen'], null, 2)))

    } catch (error) {
      console.error(chalk.red('写入配置失败:'), error)
      process.exit(1)
    }
  })

program.parse()
