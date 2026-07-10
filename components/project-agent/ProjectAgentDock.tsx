/**
 * Project Agent dock shell — Phase 2 thin wrapper over QuickComposeChatDock.
 * Title/empty copy aligned to「项目 Agent」; full Composer migration can follow.
 */

import React from 'react';
import QuickComposeChatDock, {
  type QuickComposeChatDockProps,
} from '../workflow/quickComposeChat/QuickComposeChatDock';

export type ProjectAgentDockProps = QuickComposeChatDockProps;

export default function ProjectAgentDock(props: ProjectAgentDockProps) {
  const {
    title = '项目 Agent',
    threadEmptyTitle = '跟项目里的 Agent 说话',
    threadEmptyHint = '发送后会先给出计划，再在画布出活',
    ...rest
  } = props;
  return (
    <QuickComposeChatDock
      {...rest}
      title={title}
      threadEmptyTitle={threadEmptyTitle}
      threadEmptyHint={threadEmptyHint}
    />
  );
}
