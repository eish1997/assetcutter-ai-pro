/**
 * Project Agent dock shell — Phase 2 thin wrapper over QuickComposeChatDock.
 * Title/empty copy aligned to「项目 Agent」; full Composer migration can follow.
 */

import React from 'react';
import {
  PROJECT_AGENT_EMPTY_HINT,
  PROJECT_AGENT_EMPTY_TITLE,
} from '../workflow/quickComposeChat/chatUiCopy';
import QuickComposeChatDock, {
  type QuickComposeChatDockProps,
} from '../workflow/quickComposeChat/QuickComposeChatDock';

export type ProjectAgentDockProps = QuickComposeChatDockProps;

export default function ProjectAgentDock(props: ProjectAgentDockProps) {
  const {
    title = '项目 Agent',
    threadEmptyTitle = PROJECT_AGENT_EMPTY_TITLE,
    threadEmptyHint = PROJECT_AGENT_EMPTY_HINT,
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
