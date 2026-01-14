/**
 * 命名工具函数
 */

/**
 * 转换为驼峰命名（首字母小写）
 * pos-devices -> posDevices
 * pos_devices -> posDevices
 */
export function toCamelCase(str: string): string {
  return str
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^(.)/, (_, char) => char.toLowerCase())
}

/**
 * 转换为帕斯卡命名（首字母大写）
 * pos-devices -> PosDevices
 * pos_devices -> PosDevices
 */
export function toPascalCase(str: string): string {
  const camel = toCamelCase(str)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

/**
 * 去除类型名后缀
 * CreateOrderRequest -> CreateOrder
 * OrderResponse -> Order
 */
export function removeTypeSuffix(name: string, suffixes: string[]): string {
  for (const suffix of suffixes) {
    if (name.endsWith(suffix)) {
      return name.slice(0, -suffix.length)
    }
  }
  return name
}

/**
 * 清理类型名（去掉包名前缀，转驼峰）
 * system.SysApi -> SysApi
 * response.Response -> Response
 * request.DeviceLoginRequest -> DeviceLogin (如果配置了去除 Request 后缀)
 */
export function cleanTypeName(name: string, suffixesToRemove: string[] = []): string {
  // 去掉包名前缀
  const parts = name.split('.')
  let cleanName = parts[parts.length - 1]

  // 转帕斯卡命名
  cleanName = toPascalCase(cleanName)

  // 去除后缀
  cleanName = removeTypeSuffix(cleanName, suffixesToRemove)

  return cleanName
}

/**
 * 根据路径生成函数名
 * POST /pos-devices/orders -> postPosDevicesOrders
 * GET /orders/{id} -> getOrdersById
 * GET /orders/:id -> getOrdersById
 * DELETE /orders/{id}/items/{itemId} -> deleteOrdersByIdItemsByItemId
 */
export function generateFunctionName(method: string, path: string): string {
  // 处理路径参数
  // Swagger 标准格式: {id} -> ById
  // Express 风格格式: :id -> ById
  const processedPath = path
    .replace(/\{([^}]+)\}/g, (_, param) => {
      const paramName = toPascalCase(param)
      return `/By${paramName}`
    })
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, param) => {
      const paramName = toPascalCase(param)
      return `/By${paramName}`
    })

  // 分割路径并转驼峰
  const pathParts = processedPath
    .split('/')
    .filter(Boolean)
    .map(part => toPascalCase(part))
    .join('')

  // 方法名小写 + 路径
  return method.toLowerCase() + pathParts
}

/**
 * 清理路径前缀
 * /api/v1/pos-devices/orders -> /pos-devices/orders
 */
export function cleanPathPrefix(path: string, prefixes: string[]): string {
  for (const prefix of prefixes) {
    if (path.startsWith(prefix)) {
      const result = path.slice(prefix.length)
      // 确保返回的路径以 / 开头
      return result.startsWith('/') ? result : '/' + result
    }
  }
  return path
}

/**
 * Tag 名转目录名（驼峰）
 * pos-devices -> posDevices
 * SysApi -> sysApi
 */
export function tagToDirectoryName(tag: string): string {
  return toCamelCase(tag)
}
