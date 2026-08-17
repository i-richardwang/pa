/**
 * Bun 运行时内置模块的最小声明，供 Node 侧 tsc 通过（本机脚本经 Bun 执行时才会加载）。
 * 不引入 bun-types：其全局声明与 @types/node 存在冲突面，此处只声明用到的成员
 * （构造器给 Better Auth 适配器；exec/prepare 给审计模块，与 node:sqlite 同形）。
 */
declare module "bun:sqlite" {
  export class Database {
    constructor(filename: string, options?: { readonly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: (string | number | null)[]): unknown;
      all(...params: (string | number | null)[]): unknown[];
    };
    close(): void;
  }
}
