/**
 * bun:sqlite 的最小类型声明，让 Node 侧 tsc 通过（只有经 Bun 运行的本机脚本才会加载它）。
 * 不引入 bun-types，因为它的全局声明与 @types/node 冲突；这里只声明用到的成员。
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
