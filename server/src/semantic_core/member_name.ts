/**
 * 成员限定名的唯一读法。模型成员与结果列名恒为 `view.member` 一层限定，
 * view 与 member 都是 ASCII snake_case、自身不含点；未限定的名字原样返回。
 */
export function memberShortName(member: string): string {
  return member.slice(member.lastIndexOf(".") + 1);
}

/** 限定名的 view 段；未限定的名字没有 view 段。 */
export function memberViewName(member: string): string | undefined {
  const separator = member.indexOf(".");
  return separator < 0 ? undefined : member.slice(0, separator);
}
