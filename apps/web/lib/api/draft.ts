// Reads createJob calldata from a draft, because the draft response carries the price but not the round count.
import { decodeAbiParameters, parseAbiParameters } from "viem";
import type { Draft } from "./types";

/** createJob's arguments, as in services/coordinator/api/draft.py PARAMS_T. */
export const CREATE_JOB_ARGS = parseAbiParameters(
  "(uint256,uint128,uint32,uint16,uint16,uint8,uint8,bool,uint16,uint32,(uint32,uint32,uint32,uint32,uint32),bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,string), uint256",
);

/** The draft response has no rounds field, so read it from the calldata it hands back. Null if the calldata doesn't decode. */
export function draftRounds(d: Draft): number | null {
  try {
    const [params] = decodeAbiParameters(CREATE_JOB_ARGS, `0x${d.createJobCalldata.slice(10)}`);
    return Number(params[2]);
  } catch {
    return null; // a calldata we can't read only hides the rounds row; the price still comes from the response
  }
}
