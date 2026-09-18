export const FRONT_HALL_GENERATION_DISABLED = 'front-hall-generation-disabled';
export async function disabledGeneration(..._args: unknown[]): Promise<never> {
  throw new Error('front-hall-generation-disabled');
}
