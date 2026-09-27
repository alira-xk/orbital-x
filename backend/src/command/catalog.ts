import { z } from 'zod';
import { ValidationError } from '../utils/errors.js';
import type { CommandRisk, CommandType } from './types.js';

type Role='admin'|'mission_commander'|'flight_controller';
type Contract={risk:CommandRisk; approvals:1|2; roles:readonly Role[]; schema:z.ZodType<Record<string,unknown>>};
const none=z.object({}).strict();
export const COMMAND_CATALOG:Record<CommandType,Contract>={
  CLOSE_ISOLATION_VALVE:{risk:'high',approvals:1,roles:['admin','mission_commander','flight_controller'],schema:none},
  REDUCE_THRUST:{risk:'medium',approvals:1,roles:['admin','mission_commander','flight_controller'],schema:z.object({thrustPercent:z.number().min(20).max(90)}).strict()},
  ENTER_SAFE_MODE:{risk:'high',approvals:1,roles:['admin','mission_commander','flight_controller'],schema:none},
  RESTART_FLIGHT_COMPUTER:{risk:'critical',approvals:2,roles:['admin','mission_commander'],schema:none},
};
export function parseCommandParameters(type:CommandType,value:unknown):Record<string,unknown>{
  const result=COMMAND_CATALOG[type].schema.safeParse(value);
  if(!result.success) throw new ValidationError('Invalid command parameters');
  return result.data;
}
