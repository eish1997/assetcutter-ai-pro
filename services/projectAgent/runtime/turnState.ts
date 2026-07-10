import type { AgentTurnStatus } from '../../../types/projectAgent';

/**
 * Turn state machine (§16.1).
 * idle → planning → executing → done | error
 * cancel from planning|executing → error (errorMessage = 'cancelled')
 */

export type TurnStateMachine = {
  status: AgentTurnStatus;
  turnId: string | null;
  errorMessage?: string;
};

export function createInitialTurnState(): TurnStateMachine {
  return { status: 'idle', turnId: null };
}

export type TurnEvent =
  | { type: 'submit'; turnId: string }
  | { type: 'plan_ok' }
  | { type: 'plan_fail'; errorMessage: string }
  | { type: 'exec_done' }
  | { type: 'exec_fail'; errorMessage: string }
  | { type: 'cancel' }
  | { type: 'reset' };

export function transitionTurn(state: TurnStateMachine, event: TurnEvent): TurnStateMachine {
  switch (event.type) {
    case 'reset':
      return createInitialTurnState();
    case 'submit':
      if (state.status !== 'idle' && state.status !== 'done' && state.status !== 'error') {
        return { ...state, errorMessage: state.errorMessage ?? 'Turn already in flight' };
      }
      return { status: 'planning', turnId: event.turnId };
    case 'plan_ok':
      if (state.status !== 'planning') return state;
      return { ...state, status: 'executing', errorMessage: undefined };
    case 'plan_fail':
      if (state.status !== 'planning') return state;
      return { status: 'error', turnId: state.turnId, errorMessage: event.errorMessage };
    case 'exec_done':
      if (state.status !== 'executing') return state;
      return { status: 'done', turnId: state.turnId };
    case 'exec_fail':
      if (state.status !== 'executing') return state;
      return { status: 'error', turnId: state.turnId, errorMessage: event.errorMessage };
    case 'cancel':
      if (state.status !== 'planning' && state.status !== 'executing') return state;
      return { status: 'error', turnId: state.turnId, errorMessage: 'cancelled' };
    default:
      return state;
  }
}

export function isTerminalTurnStatus(status: AgentTurnStatus): boolean {
  return status === 'done' || status === 'error';
}

export function canSubmitNewTurn(status: AgentTurnStatus): boolean {
  return status === 'idle' || isTerminalTurnStatus(status);
}

export function isCancelledTurn(state: TurnStateMachine): boolean {
  return state.status === 'error' && state.errorMessage === 'cancelled';
}
