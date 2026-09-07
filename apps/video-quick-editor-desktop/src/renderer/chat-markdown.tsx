import { memo } from "react";
import { Streamdown, type Components } from "streamdown";
import { cjk } from "@streamdown/cjk";
import type { Language } from "@video-quick-editor/shared";
import { copyFor } from "./i18n.js";

// Model output cannot load remote images or navigate the editor window.
const components: Components = {
  a: ({ children, href }) => (
    <span className="chat-link" title={href}>
      {children}
    </span>
  ),
  img: ({ alt }) => <span>{alt}</span>,
};
const plugins = { cjk };
const controls = { code: { copy: true, download: false }, table: false };

export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  streaming,
  language,
}: {
  text: string;
  streaming: boolean;
  language: Language;
}) {
  const copy = copyFor(language);
  return (
    <Streamdown
      className="chat-markdown"
      plugins={plugins}
      components={components}
      controls={controls}
      translations={{ copyCode: copy.chatCopyCode, copied: copy.chatCopied }}
      skipHtml
      isAnimating={streaming}
      mode={streaming ? "streaming" : "static"}
      caret="circle"
      codeBlockMaxHeight={240}
      tableMaxHeight={240}
    >
      {text}
    </Streamdown>
  );
});
