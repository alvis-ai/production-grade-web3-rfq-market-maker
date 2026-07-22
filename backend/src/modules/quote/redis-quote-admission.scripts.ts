import {
  quoteExposureLuaHelpers,
  quoteExposureReservationLuaFunctions,
} from "../risk/redis-quote-exposure.scripts.js";
import { quoteIssuanceAdmissionLuaFunctions } from "./redis-quote-issuance.scripts.js";

export const admitQuoteAtomicallyScript = `${quoteExposureLuaHelpers}${quoteExposureReservationLuaFunctions}${quoteIssuanceAdmissionLuaFunctions}
local exposure = prepare_quote_exposure_reservation()
if exposure.result and exposure.result[1] ~= 2 then
  return {exposure.result, {}}
end

local issuance = prepare_quote_issuance_admission(
  {KEYS[10], KEYS[11], KEYS[12]},
  {ARGV[11], ARGV[12], ARGV[13], ARGV[14], ARGV[15], ARGV[16], ARGV[17], ARGV[18], ARGV[19], ARGV[20], ARGV[21], ARGV[22]}
)
if issuance.result and issuance.result[1] ~= 2 then
  local exposure_backlog = exposure.result and exposure.result[3] or exposure.backlog
  return {{4, "issuance_conflict", exposure_backlog}, issuance.result}
end

local exposure_result = exposure.result or apply_quote_exposure_reservation(exposure)
local issuance_result = issuance.result or apply_quote_issuance_admission(issuance)
return {exposure_result, issuance_result}
`;
