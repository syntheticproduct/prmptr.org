"use client";

import {
  Editor,
  defaultValueCtx,
  rootCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { history } from "@milkdown/kit/plugin/history";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";

import "@milkdown/kit/prose/view/style/prosemirror.css";
import "@milkdown/kit/prose/tables/style/tables.css";
import "@milkdown/kit/prose/gapcursor/style/gapcursor.css";

type Props = {
  defaultValue: string;
  onChange: (markdown: string) => void;
};

function MilkdownInner({ defaultValue, onChange }: Props) {
  useEditor((root) =>
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, defaultValue);
        ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
          onChange(markdown);
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(listener)
      .use(history),
  );

  return <Milkdown />;
}

export function MilkdownEditor(props: Props) {
  return (
    <MilkdownProvider>
      <MilkdownInner {...props} />
    </MilkdownProvider>
  );
}
