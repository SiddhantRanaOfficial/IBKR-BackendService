-- compare and extend atomically, using Redis expiration times.
local cooldownKey = KEYS[1]
local requestedMilliseconds = tonumber(ARGV[1])
local remainingMilliseconds = redis.call('PTTL', cooldownKey)
if remainingMilliseconds == -1 then
  return redis.error_reply('Cooldown has no expiry')
end

-- A shorter cooldown must never replace a longer one.
-- An absent key has lifetime -2, so this also creates a new cooldown.
if requestedMilliseconds > remainingMilliseconds then
  redis.call('SET', cooldownKey, 'blocked', 'PX', ARGV[1])
  return requestedMilliseconds
end
return remainingMilliseconds

-- Script 1 (checkRequestLimit.Lua) is used to check if a request is allowed based on the current cooldown. 
-- It returns the remaining cooldown time if the request is blocked, or 0 if the request is allowed.

-- Script 2 (extendCooldown.Lua) is used to extend the cooldown period if a request is blocked.
-- Both these are individually atomic operations, but they are not atomic together. This means that 
-- if you check the request limit and then extend the cooldown in two separate calls, there is a risk of race conditions where the state may change between the two calls.
-- Process A might get admitted and allowed for the external 
-- service, while at the same time Process B might be blocked and extend the cooldown, l
-- eading to inconsistent state.

-- This is a limitation of the current implementation.
-- To avoid this, you might think that you can combine the two scripts into a single Lua script 
-- that checks the request limit and extends the cooldown in one atomic operation. 
-- This way, you can ensure that the state remains consistent and avoid race conditions.
-- But this is not possible because the two scripts have different return values. The first script returns the remaining cooldown time, 
-- while the second script returns the new cooldown time.
-- They both run at different times. One before sending the request to the external service, 
-- and the other after receiving a response from the external service.