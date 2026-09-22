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
