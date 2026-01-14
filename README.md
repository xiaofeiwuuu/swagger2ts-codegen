# swagger2ts-codegen

从 Swagger/OpenAPI 规范自动生成 TypeScript 类型定义和 API 请求函数。

**支持版本：** Swagger 2.0 和 OpenAPI 3.0

## 安装

```bash
npm install swagger2ts-codegen -D
```

## 快速开始

```bash
# 1. 初始化配置
npx swagger2ts-codegen init

# 2. 编辑 package.json 中的配置

# 3. 生成 API 文件
npx swagger2ts-codegen update
```

## 命令

### `swagger2ts-codegen init`

在 `package.json` 中初始化 `swagger2ts-codegen` 配置。

```bash
npx swagger2ts-codegen init
```

执行后会在 `package.json` 中添加默认配置模板。

### `swagger2ts-codegen update`

根据 Swagger 规范生成/更新 TypeScript 类型和 API 函数。

```bash
# 基本用法
npx swagger2ts-codegen update

# 清理旧目录后重新生成
npx swagger2ts-codegen update --clean

# 仅生成 tag 映射文件（不生成代码）
npx swagger2ts-codegen update --init-only
```

**选项：**

| 选项 | 说明 |
|------|------|
| `--clean` | 生成前清空输出目录（保留 `tag-mapping.json`） |
| `--init-only` | 仅生成/更新 `tag-mapping.json`，不生成代码。用于首次配置 tag 映射 |

**智能合并：**

生成的 API 文件使用标记区分自动生成和手写代码：

```typescript
// --- AUTO GENERATED START ---
// 自动生成的代码，每次更新会被覆盖
export const getUsers = () => { ... }
// --- AUTO GENERATED END ---

// 标记外的代码不会被覆盖，可以安全添加自定义函数
export const customFunction = () => { ... }
```

### `swagger2ts-codegen check`

检测 Swagger 规范与现有 API 文件的差异，生成变更报告 `changelog.md`。

```bash
npx swagger2ts-codegen check
```

报告内容包括：
- 新增/删除/修改的类型
- 新增/删除的 API 接口
- 类型字段的变更详情

## 配置

在 `package.json` 中添加 `swagger2ts-codegen` 字段：

```json
{
  "swagger2ts-codegen": {
    "input": "./swagger.json",
    "output": "./src/api",
    "requestStyle": "chain",
    "requestClient": "requestClient",
    "requestImport": "@/utils/request",
    "pathPrefixFilter": ["/api/v1", "/api"],
    "typeNameSuffixFilter": ["Request", "Response"],
    "excludeFields": ["fingerprint", "token"],
    "unwrapResponseField": "data",
    "tagMapping": {
      "管理员": "admin",
      "用户": "user"
    }
  }
}
```

### 配置项说明

#### `input`

**类型：** `string`
**默认值：** `"./swagger.json"`

Swagger/OpenAPI 规范文件路径。支持：
- 本地文件：`"./swagger.json"` 或 `"./openapi.json"`
- 远程 URL：`"https://api.example.com/swagger.json"`
- **格式自动检测**：根据文件内容自动识别 Swagger 2.0 或 OpenAPI 3.0

#### `output`

**类型：** `string`
**默认值：** `"./src/api"`

生成文件的输出目录。会按 Swagger tag 自动创建子目录。

#### `requestStyle`

**类型：** `"chain" | "object"`
**默认值：** `"chain"`

生成的 API 函数风格。

**chain 风格（链式调用）：**
```typescript
export const getUsers = () => {
  return requestClient.get<User[]>('/users')
}

export const createUser = (data: CreateUserBody) => {
  return requestClient.post<User>('/users', data)
}
```

**object 风格（配置对象）：**
```typescript
export const getUsers = () => {
  return requestClient<User[]>({
    url: '/users',
    method: 'get'
  })
}

export const createUser = (data: CreateUserBody) => {
  return requestClient<User>({
    url: '/users',
    method: 'post',
    data
  })
}
```

#### `requestClient`

**类型：** `string`
**默认值：** `"requestClient"`

请求客户端的变量名。

#### `requestImport`

**类型：** `string`
**默认值：** `"@/utils/request"`

请求客户端的导入路径。生成的代码会包含：
```typescript
import { requestClient } from '@/utils/request'
```

#### `pathPrefixFilter`

**类型：** `string[]`
**默认值：** `["/api/v1", "/api"]`

路径前缀过滤列表。匹配的前缀会从生成的路径中移除。

**示例：**
- 原始路径：`/api/v1/users`
- 过滤后：`/users`

列表会按长度降序排序，优先匹配更长的前缀。

#### `typeNameSuffixFilter`

**类型：** `string[]`
**默认值：** `["Request", "Response"]`

类型名后缀过滤列表。匹配的后缀会从生成的类型名中移除。

**示例：**
- 原始类型名：`CreateUserRequest`
- 过滤后：`CreateUser`

#### `excludeFields`

**类型：** `string[]`
**默认值：** `[]`

排除的字段名列表。这些字段不会出现在生成的类型定义中。

适用于由请求拦截器自动注入的字段（如 `fingerprint`、`token`），用户不需要手动传递。

**示例：**
```json
{
  "excludeFields": ["fingerprint", "two_auth", "device_id"]
}
```

#### `unwrapResponseField`

**类型：** `string | null`
**默认值：** `"data"`

响应解包字段名。

如果你的 API 响应格式为：
```json
{
  "code": 200,
  "message": "success",
  "data": { "id": 1, "name": "test" }
}
```

设置 `"unwrapResponseField": "data"` 后，生成的返回类型会直接使用 `data` 字段的类型，而不是整个响应对象。

设为 `null` 则不解包，使用完整响应类型。

#### `tagMapping`

**类型：** `Record<string, string>`
**默认值：** `{}`

Swagger tag 到目录名的映射。用于将中文 tag 转换为英文目录名。

**示例：**
```json
{
  "tagMapping": {
    "管理员": "admin",
    "用户管理": "user",
    "订单": "order"
  }
}
```

**注意：**
- 未映射的 tag 会使用原始名称（转驼峰）
- 运行 `update` 时会提示未映射的 tag
- 也支持在 `output` 目录下的 `tag-mapping.json` 文件中配置（向后兼容）

## 生成的文件结构

```
src/api/
├── admin/
│   ├── types.ts      # 类型定义
│   └── index.ts      # API 函数
├── user/
│   ├── types.ts
│   └── index.ts
├── order/
│   ├── types.ts
│   └── index.ts
└── tag-mapping.json  # tag 映射文件（可选）
```

## 工作流示例

### 首次使用

```bash
# 1. 初始化配置
npx swagger2ts-codegen init

# 2. 编辑 package.json 配置
# - 设置 input 为你的 swagger 文件路径
# - 设置 output 为输出目录
# - 配置其他选项

# 3. 查看所有 tag 并配置映射
npx swagger2ts-codegen update --init-only
# 根据提示在 package.json 中添加 tagMapping

# 4. 生成代码
npx swagger2ts-codegen update
```

### 日常更新

```bash
# 检查变更
npx swagger2ts-codegen check

# 更新代码
npx swagger2ts-codegen update

# 如果需要清理旧目录
npx swagger2ts-codegen update --clean
```

### 处理新增 tag

当 Swagger 中新增了 tag 时：

1. 运行 `update` 会提示未映射的 tag
2. 在 `package.json` 的 `tagMapping` 中添加映射
3. 使用 `--clean` 重新生成

```bash
npx swagger2ts-codegen update --clean
```

## 注意事项

1. **类型文件会完全覆盖**：`types.ts` 每次都会重新生成
2. **API 文件智能合并**：`index.ts` 中 `AUTO GENERATED` 标记外的代码会保留
3. **路径参数支持**：同时支持 `{id}` 和 `:id` 两种格式

## 版本支持

### Swagger 2.0

完整支持 Swagger 2.0 规范：
- `definitions` 中的类型定义
- `parameters` 中的 `body`、`query`、`path` 参数
- `responses` 中的响应类型

### OpenAPI 3.0

完整支持 OpenAPI 3.0 规范：
- `components.schemas` 中的类型定义
- `requestBody.content['application/json']` 请求体
- `responses.content['application/json']` 响应体
- 参数的 `schema` 包装格式

**版本自动检测**：工具会根据文件内容自动识别版本：
- 包含 `"swagger": "2.0"` → Swagger 2.0
- 包含 `"openapi": "3.x.x"` → OpenAPI 3.0

## License

MIT
