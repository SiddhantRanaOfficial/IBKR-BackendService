-- Redis will execute this whole script without interleaving requests.
-- KEYS are key names and ARGV are values supplied by our JavaScript service.
local globalRequestsKey = KEYS[1]
local historyRequestsKey = KEYS[2]
local cooldownKey = KEYS[3]
local isHistoryRequest = ARGV[1] == '1'
local requestId = ARGV[2]
local globalLimit = 10
local historyLimit = 50
local globalWindowMilliseconds = 1000
local historyWindowMilliseconds = 60000

-- We will use Redis's clock so every backend process agrees on the time.
-- TIME returns seconds and microseconds which we will convert to milliseconds.
local redisTime = redis.call('TIME')
local nowMilliseconds = tonumber(redisTime[1]) * 1000
  + math.floor(tonumber(redisTime[2]) / 1000)

-- Remove records outside the rolling windows. Sorted sets store request
-- IDs ordered by their timestamps (the scores).
redis.call('ZREMRANGEBYSCORE', globalRequestsKey, '-inf', nowMilliseconds - globalWindowMilliseconds)
redis.call('ZREMRANGEBYSCORE', historyRequestsKey, '-inf', nowMilliseconds - historyWindowMilliseconds)

-- PTTL returns the remaining lifetime in milliseconds of the key passed as an argument.   
-- It returns -2 if the key does not exist and -1 if the key exists but has no associated expire(which is invalid for our cooldown). 
-- This will be used to check if the cooldown is active.
local cooldownRemaining = redis.call('PTTL', cooldownKey)
if cooldownRemaining == -1 then
  return redis.error_reply('Cooldown has no expiry')
end
local retryAfterMilliseconds = math.max(0, cooldownRemaining)

-- This function finds when enough recorded requests will leave a full window
-- making space for a new request. It returns zero if the window is not full.
local function getWindowWait(requestsKey, limit, windowMilliseconds)
  local requestCount = redis.call('ZCARD', requestsKey)
  if requestCount < limit then
    return 0
  end
  -- Positions start at zero. Usually count == limit, so we read the oldest
  -- request. This calculation also handles a set with more than the limit.
  local expiryPosition = requestCount - limit
  local request = redis.call('ZRANGE', requestsKey, expiryPosition, expiryPosition, 'WITHSCORES')
  local requestTimestamp = tonumber(request[2])
  return requestTimestamp + windowMilliseconds - nowMilliseconds
end

-- 4. Every request uses the global allowance while history also uses its own.
retryAfterMilliseconds = math.max(retryAfterMilliseconds,
  getWindowWait(globalRequestsKey, globalLimit, globalWindowMilliseconds))
if isHistoryRequest then
  retryAfterMilliseconds = math.max(retryAfterMilliseconds,
    getWindowWait(historyRequestsKey, historyLimit, historyWindowMilliseconds))
end

-- 5. Reject without recording a request in either set.
if retryAfterMilliseconds > 0 then
  return retryAfterMilliseconds
end

-- 6. Record admission of requests and expire inactive sets automatically to release memory.
redis.call('ZADD', globalRequestsKey, nowMilliseconds, requestId)
redis.call('PEXPIRE', globalRequestsKey, globalWindowMilliseconds)
if isHistoryRequest then
  redis.call('ZADD', historyRequestsKey, nowMilliseconds, requestId)
  redis.call('PEXPIRE', historyRequestsKey, historyWindowMilliseconds)
end
-- Zero means request is allowed while positive values mean how many milliseconds to wait.
return 0

-- This however doesn't support rollback of an admitted request 
-- incase something goes wrong in the backend service after admission.