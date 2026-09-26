/** 限定名格式为 `view.member`，两段都是不含点的 ASCII snake_case；未限定的名字原样返回。 */
export function memberShortName(member: string): string {
  return member.slice(member.lastIndexOf(".") + 1);
}

export function memberViewName(member: string): string | undefined {
  const separator = member.indexOf(".");
  return separator < 0 ? undefined : member.slice(0, separator);
}
