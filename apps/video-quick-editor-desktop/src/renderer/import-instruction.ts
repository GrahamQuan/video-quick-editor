/** Extract local sources from import or editing requests before contacting the model. */
export function parseImportInstruction(
  text: string,
): { paths: string[]; instruction: string } | null {
  const paths: string[] = [];
  const pattern =
    /`((?:\/|~\/|file:\/\/)[^`]+)`|"((?:\/|~\/|file:\/\/)[^"]+)"|'((?:\/|~\/|file:\/\/)[^']+)'|((?:file:\/\/|~\/|\/)[^\s，。；、,;`"'<>]+)/g;
  const normalized = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const instruction = normalized.replace(
    pattern,
    (_match, backtick: string, double: string, single: string, bare: string) => {
      const path = backtick ?? double ?? single ?? bare;
      paths.push(path);
      return `[imported source ${paths.length}]`;
    },
  );
  // Inspect prose after removing filenames, so a filename such as trim.mp4 is not authorization.
  const prohibited =
    /(?:不要|别|禁止)\s*(?:自动)?(?:导入|加载|读取)|\b(?:do not|don't|never)\s+(?:automatically\s+)?(?:import|load|read)\b/i;
  const question = /^(?:请问\s*)?(?:如何|怎么|怎样|是否|能否|\bhow\b|\bwhat\b)/i;
  const action =
    /导入|添加|加载|剪辑|裁剪|拼接|合并|截取|保留|\b(?:import|add|load|trim|cut|join|merge|combine|edit)\b/i;
  if (
    !paths.length ||
    prohibited.test(instruction) ||
    question.test(instruction.trim()) ||
    !action.test(instruction)
  )
    return null;
  return { paths, instruction };
}
