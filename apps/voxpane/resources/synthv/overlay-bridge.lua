--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]

local ____modules = {}
local ____moduleCache = {}
local ____originalRequire = require
local function require(file, ...)
    if ____moduleCache[file] then
        return ____moduleCache[file].value
    end
    if ____modules[file] then
        local module = ____modules[file]
        local value = nil
        if (select("#", ...) > 0) then value = module(...) else value = module(file) end
        ____moduleCache[file] = { value = value }
        return value
    else
        if ____originalRequire then
            return ____originalRequire(file)
        else
            error("module '" .. file .. "' not found")
        end
    end
end
____modules = {
["lualib_bundle"] = function(...) 
local function __TS__ArrayAt(self, relativeIndex)
    local absoluteIndex = relativeIndex < 0 and #self + relativeIndex or relativeIndex
    if absoluteIndex >= 0 and absoluteIndex < #self then
        return self[absoluteIndex + 1]
    end
    return nil
end

local function __TS__ArrayIsArray(value)
    return type(value) == "table" and (value[1] ~= nil or next(value) == nil)
end

local function __TS__ArrayConcat(self, ...)
    local items = {...}
    local result = {}
    local len = 0
    for i = 1, #self do
        len = len + 1
        result[len] = self[i]
    end
    for i = 1, #items do
        local item = items[i]
        if __TS__ArrayIsArray(item) then
            for j = 1, #item do
                len = len + 1
                result[len] = item[j]
            end
        else
            len = len + 1
            result[len] = item
        end
    end
    return result
end

local __TS__Symbol, Symbol
do
    local symbolMetatable = {__tostring = function(self)
        return ("Symbol(" .. (self.description or "")) .. ")"
    end}
    function __TS__Symbol(description)
        return setmetatable({description = description}, symbolMetatable)
    end
    Symbol = {
        asyncDispose = __TS__Symbol("Symbol.asyncDispose"),
        dispose = __TS__Symbol("Symbol.dispose"),
        iterator = __TS__Symbol("Symbol.iterator"),
        hasInstance = __TS__Symbol("Symbol.hasInstance"),
        species = __TS__Symbol("Symbol.species"),
        toStringTag = __TS__Symbol("Symbol.toStringTag")
    }
end

local function __TS__ArrayEntries(array)
    local key = 0
    return {
        [Symbol.iterator] = function(self)
            return self
        end,
        next = function(self)
            local result = {done = array[key + 1] == nil, value = {key, array[key + 1]}}
            key = key + 1
            return result
        end
    }
end

local function __TS__ArrayEvery(self, callbackfn, thisArg)
    for i = 1, #self do
        if not callbackfn(thisArg, self[i], i - 1, self) then
            return false
        end
    end
    return true
end

local function __TS__ArrayFill(self, value, start, ____end)
    local relativeStart = start or 0
    local relativeEnd = ____end or #self
    if relativeStart < 0 then
        relativeStart = relativeStart + #self
    end
    if relativeEnd < 0 then
        relativeEnd = relativeEnd + #self
    end
    do
        local i = relativeStart
        while i < relativeEnd do
            self[i + 1] = value
            i = i + 1
        end
    end
    return self
end

local function __TS__ArrayFilter(self, callbackfn, thisArg)
    local result = {}
    local len = 0
    for i = 1, #self do
        if callbackfn(thisArg, self[i], i - 1, self) then
            len = len + 1
            result[len] = self[i]
        end
    end
    return result
end

local function __TS__ArrayForEach(self, callbackFn, thisArg)
    for i = 1, #self do
        callbackFn(thisArg, self[i], i - 1, self)
    end
end

local function __TS__ArrayFind(self, predicate, thisArg)
    for i = 1, #self do
        local elem = self[i]
        if predicate(thisArg, elem, i - 1, self) then
            return elem
        end
    end
    return nil
end

local function __TS__ArrayFindIndex(self, callbackFn, thisArg)
    for i = 1, #self do
        if callbackFn(thisArg, self[i], i - 1, self) then
            return i - 1
        end
    end
    return -1
end

local __TS__Iterator
do
    local function iteratorGeneratorStep(self)
        local co = self.____coroutine
        local status, value = coroutine.resume(co)
        if not status then
            error(value, 0)
        end
        if coroutine.status(co) == "dead" then
            return
        end
        return true, value
    end
    local function iteratorIteratorStep(self)
        local result = self:next()
        if result.done then
            return
        end
        return true, result.value
    end
    local function iteratorStringStep(self, index)
        index = index + 1
        if index > #self then
            return
        end
        return index, string.sub(self, index, index)
    end
    function __TS__Iterator(iterable)
        if type(iterable) == "string" then
            return iteratorStringStep, iterable, 0
        elseif iterable.____coroutine ~= nil then
            return iteratorGeneratorStep, iterable
        elseif iterable[Symbol.iterator] then
            local iterator = iterable[Symbol.iterator](iterable)
            return iteratorIteratorStep, iterator
        else
            return ipairs(iterable)
        end
    end
end

local __TS__ArrayFrom
do
    local function arrayLikeStep(self, index)
        index = index + 1
        if index > self.length then
            return
        end
        return index, self[index]
    end
    local function arrayLikeIterator(arr)
        if type(arr.length) == "number" then
            return arrayLikeStep, arr, 0
        end
        return __TS__Iterator(arr)
    end
    function __TS__ArrayFrom(arrayLike, mapFn, thisArg)
        local result = {}
        if mapFn == nil then
            for ____, v in arrayLikeIterator(arrayLike) do
                result[#result + 1] = v
            end
        else
            local i = 0
            for ____, v in arrayLikeIterator(arrayLike) do
                local ____mapFn_3 = mapFn
                local ____thisArg_1 = thisArg
                local ____v_2 = v
                local ____i_0 = i
                i = ____i_0 + 1
                result[#result + 1] = ____mapFn_3(____thisArg_1, ____v_2, ____i_0)
            end
        end
        return result
    end
end

local function __TS__ArrayIncludes(self, searchElement, fromIndex)
    if fromIndex == nil then
        fromIndex = 0
    end
    local len = #self
    local k = fromIndex
    if fromIndex < 0 then
        k = len + fromIndex
    end
    if k < 0 then
        k = 0
    end
    for i = k + 1, len do
        if self[i] == searchElement then
            return true
        end
    end
    return false
end

local function __TS__ArrayIndexOf(self, searchElement, fromIndex)
    if fromIndex == nil then
        fromIndex = 0
    end
    local len = #self
    if len == 0 then
        return -1
    end
    if fromIndex >= len then
        return -1
    end
    if fromIndex < 0 then
        fromIndex = len + fromIndex
        if fromIndex < 0 then
            fromIndex = 0
        end
    end
    for i = fromIndex + 1, len do
        if self[i] == searchElement then
            return i - 1
        end
    end
    return -1
end

local function __TS__ArrayJoin(self, separator)
    if separator == nil then
        separator = ","
    end
    local parts = {}
    for i = 1, #self do
        parts[i] = tostring(self[i])
    end
    return table.concat(parts, separator)
end

local function __TS__ArrayMap(self, callbackfn, thisArg)
    local result = {}
    for i = 1, #self do
        result[i] = callbackfn(thisArg, self[i], i - 1, self)
    end
    return result
end

local function __TS__ArrayPush(self, ...)
    local items = {...}
    local len = #self
    for i = 1, #items do
        len = len + 1
        self[len] = items[i]
    end
    return len
end

local function __TS__ArrayPushArray(self, items)
    local len = #self
    for i = 1, #items do
        len = len + 1
        self[len] = items[i]
    end
    return len
end

local function __TS__CountVarargs(...)
    return select("#", ...)
end

local function __TS__ArrayReduce(self, callbackFn, ...)
    local len = #self
    local k = 0
    local accumulator = nil
    if __TS__CountVarargs(...) ~= 0 then
        accumulator = ...
    elseif len > 0 then
        accumulator = self[1]
        k = 1
    else
        error("Reduce of empty array with no initial value", 0)
    end
    for i = k + 1, len do
        accumulator = callbackFn(
            nil,
            accumulator,
            self[i],
            i - 1,
            self
        )
    end
    return accumulator
end

local function __TS__ArrayReduceRight(self, callbackFn, ...)
    local len = #self
    local k = len - 1
    local accumulator = nil
    if __TS__CountVarargs(...) ~= 0 then
        accumulator = ...
    elseif len > 0 then
        accumulator = self[k + 1]
        k = k - 1
    else
        error("Reduce of empty array with no initial value", 0)
    end
    for i = k + 1, 1, -1 do
        accumulator = callbackFn(
            nil,
            accumulator,
            self[i],
            i - 1,
            self
        )
    end
    return accumulator
end

local function __TS__ArrayReverse(self)
    local i = 1
    local j = #self
    while i < j do
        local temp = self[j]
        self[j] = self[i]
        self[i] = temp
        i = i + 1
        j = j - 1
    end
    return self
end

local function __TS__ArrayUnshift(self, ...)
    local items = {...}
    local numItemsToInsert = #items
    if numItemsToInsert == 0 then
        return #self
    end
    for i = #self, 1, -1 do
        self[i + numItemsToInsert] = self[i]
    end
    for i = 1, numItemsToInsert do
        self[i] = items[i]
    end
    return #self
end

local function __TS__ArraySort(self, compareFn)
    if compareFn ~= nil then
        table.sort(
            self,
            function(a, b) return compareFn(nil, a, b) < 0 end
        )
    else
        table.sort(self)
    end
    return self
end

local function __TS__ArraySlice(self, first, last)
    local len = #self
    first = first or 0
    if first < 0 then
        first = len + first
        if first < 0 then
            first = 0
        end
    else
        if first > len then
            first = len
        end
    end
    last = last or len
    if last < 0 then
        last = len + last
        if last < 0 then
            last = 0
        end
    else
        if last > len then
            last = len
        end
    end
    local out = {}
    first = first + 1
    last = last + 1
    local n = 1
    while first < last do
        out[n] = self[first]
        first = first + 1
        n = n + 1
    end
    return out
end

local function __TS__ArraySome(self, callbackfn, thisArg)
    for i = 1, #self do
        if callbackfn(thisArg, self[i], i - 1, self) then
            return true
        end
    end
    return false
end

local function __TS__ArraySplice(self, ...)
    local args = {...}
    local len = #self
    local actualArgumentCount = __TS__CountVarargs(...)
    local start = args[1]
    local deleteCount = args[2]
    if start < 0 then
        start = len + start
        if start < 0 then
            start = 0
        end
    elseif start > len then
        start = len
    end
    local itemCount = actualArgumentCount - 2
    if itemCount < 0 then
        itemCount = 0
    end
    local actualDeleteCount
    if actualArgumentCount == 0 then
        actualDeleteCount = 0
    elseif actualArgumentCount == 1 then
        actualDeleteCount = len - start
    else
        actualDeleteCount = deleteCount or 0
        if actualDeleteCount < 0 then
            actualDeleteCount = 0
        end
        if actualDeleteCount > len - start then
            actualDeleteCount = len - start
        end
    end
    local out = {}
    for k = 1, actualDeleteCount do
        local from = start + k
        if self[from] ~= nil then
            out[k] = self[from]
        end
    end
    if itemCount < actualDeleteCount then
        for k = start + 1, len - actualDeleteCount do
            local from = k + actualDeleteCount
            local to = k + itemCount
            if self[from] then
                self[to] = self[from]
            else
                self[to] = nil
            end
        end
        for k = len - actualDeleteCount + itemCount + 1, len do
            self[k] = nil
        end
    elseif itemCount > actualDeleteCount then
        for k = len - actualDeleteCount, start + 1, -1 do
            local from = k + actualDeleteCount
            local to = k + itemCount
            if self[from] then
                self[to] = self[from]
            else
                self[to] = nil
            end
        end
    end
    local j = start + 1
    for i = 3, actualArgumentCount do
        self[j] = args[i]
        j = j + 1
    end
    for k = #self, len - actualDeleteCount + itemCount + 1, -1 do
        self[k] = nil
    end
    return out
end

local function __TS__ArrayToObject(self)
    local object = {}
    for i = 1, #self do
        object[i - 1] = self[i]
    end
    return object
end

local function __TS__ArrayFlat(self, depth)
    if depth == nil then
        depth = 1
    end
    local result = {}
    local len = 0
    for i = 1, #self do
        local value = self[i]
        if depth > 0 and __TS__ArrayIsArray(value) then
            local toAdd
            if depth == 1 then
                toAdd = value
            else
                toAdd = __TS__ArrayFlat(value, depth - 1)
            end
            for j = 1, #toAdd do
                local val = toAdd[j]
                len = len + 1
                result[len] = val
            end
        else
            len = len + 1
            result[len] = value
        end
    end
    return result
end

local function __TS__ArrayFlatMap(self, callback, thisArg)
    local result = {}
    local len = 0
    for i = 1, #self do
        local value = callback(thisArg, self[i], i - 1, self)
        if __TS__ArrayIsArray(value) then
            for j = 1, #value do
                len = len + 1
                result[len] = value[j]
            end
        else
            len = len + 1
            result[len] = value
        end
    end
    return result
end

local function __TS__ArraySetLength(self, length)
    if length < 0 or length ~= length or length == math.huge or math.floor(length) ~= length then
        error(
            "invalid array length: " .. tostring(length),
            0
        )
    end
    for i = length + 1, #self do
        self[i] = nil
    end
    return length
end

local __TS__Unpack = table.unpack or unpack

local function __TS__ArrayToReversed(self)
    local copy = {__TS__Unpack(self)}
    __TS__ArrayReverse(copy)
    return copy
end

local function __TS__ArrayToSorted(self, compareFn)
    local copy = {__TS__Unpack(self)}
    __TS__ArraySort(copy, compareFn)
    return copy
end

local function __TS__ArrayToSpliced(self, start, deleteCount, ...)
    local copy = {__TS__Unpack(self)}
    __TS__ArraySplice(copy, start, deleteCount, ...)
    return copy
end

local function __TS__ArrayWith(self, index, value)
    local copy = {__TS__Unpack(self)}
    copy[index + 1] = value
    return copy
end

local function __TS__New(target, ...)
    local instance = setmetatable({}, target.prototype)
    instance:____constructor(...)
    return instance
end

local function __TS__InstanceOf(obj, classTbl)
    if type(classTbl) ~= "table" then
        error("Right-hand side of 'instanceof' is not an object", 0)
    end
    if classTbl[Symbol.hasInstance] ~= nil then
        return not not classTbl[Symbol.hasInstance](classTbl, obj)
    end
    if type(obj) == "table" then
        local luaClass = obj.constructor
        while luaClass ~= nil do
            if luaClass == classTbl then
                return true
            end
            luaClass = luaClass.____super
        end
    end
    return false
end

local function __TS__Class(self)
    local c = {prototype = {}}
    c.prototype.__index = c.prototype
    c.prototype.constructor = c
    return c
end

local __TS__Promise
do
    local function makeDeferredPromiseFactory()
        local resolve
        local reject
        local function executor(____, res, rej)
            resolve = res
            reject = rej
        end
        return function()
            local promise = __TS__New(__TS__Promise, executor)
            return promise, resolve, reject
        end
    end
    local makeDeferredPromise = makeDeferredPromiseFactory()
    local function isPromiseLike(value)
        return __TS__InstanceOf(value, __TS__Promise)
    end
    local function doNothing(self)
    end
    local ____pcall = _G.pcall
    __TS__Promise = __TS__Class()
    __TS__Promise.name = "__TS__Promise"
    function __TS__Promise.prototype.____constructor(self, executor)
        self.state = 0
        self.fulfilledCallbacks = {}
        self.rejectedCallbacks = {}
        self.finallyCallbacks = {}
        local success, ____error = ____pcall(
            executor,
            nil,
            function(____, v) return self:resolve(v) end,
            function(____, err) return self:reject(err) end
        )
        if not success then
            self:reject(____error)
        end
    end
    function __TS__Promise.resolve(value)
        if __TS__InstanceOf(value, __TS__Promise) then
            return value
        end
        local promise = __TS__New(__TS__Promise, doNothing)
        promise.state = 1
        promise.value = value
        return promise
    end
    function __TS__Promise.reject(reason)
        local promise = __TS__New(__TS__Promise, doNothing)
        promise.state = 2
        promise.rejectionReason = reason
        return promise
    end
    __TS__Promise.prototype["then"] = function(self, onFulfilled, onRejected)
        local promise, resolve, reject = makeDeferredPromise()
        self:addCallbacks(
            onFulfilled and self:createPromiseResolvingCallback(onFulfilled, resolve, reject) or resolve,
            onRejected and self:createPromiseResolvingCallback(onRejected, resolve, reject) or reject
        )
        return promise
    end
    function __TS__Promise.prototype.addCallbacks(self, fulfilledCallback, rejectedCallback)
        if self.state == 1 then
            return fulfilledCallback(nil, self.value)
        end
        if self.state == 2 then
            return rejectedCallback(nil, self.rejectionReason)
        end
        local ____self_fulfilledCallbacks_0 = self.fulfilledCallbacks
        ____self_fulfilledCallbacks_0[#____self_fulfilledCallbacks_0 + 1] = fulfilledCallback
        local ____self_rejectedCallbacks_1 = self.rejectedCallbacks
        ____self_rejectedCallbacks_1[#____self_rejectedCallbacks_1 + 1] = rejectedCallback
    end
    function __TS__Promise.prototype.catch(self, onRejected)
        return self["then"](self, nil, onRejected)
    end
    function __TS__Promise.prototype.finally(self, onFinally)
        if onFinally then
            local ____self_finallyCallbacks_2 = self.finallyCallbacks
            ____self_finallyCallbacks_2[#____self_finallyCallbacks_2 + 1] = onFinally
            if self.state ~= 0 then
                onFinally(nil)
            end
        end
        return self
    end
    function __TS__Promise.prototype.resolve(self, value)
        if isPromiseLike(value) then
            return value:addCallbacks(
                function(____, v) return self:resolve(v) end,
                function(____, err) return self:reject(err) end
            )
        end
        if self.state == 0 then
            self.state = 1
            self.value = value
            return self:invokeCallbacks(self.fulfilledCallbacks, value)
        end
    end
    function __TS__Promise.prototype.reject(self, reason)
        if self.state == 0 then
            self.state = 2
            self.rejectionReason = reason
            return self:invokeCallbacks(self.rejectedCallbacks, reason)
        end
    end
    function __TS__Promise.prototype.invokeCallbacks(self, callbacks, value)
        local callbacksLength = #callbacks
        local finallyCallbacks = self.finallyCallbacks
        local finallyCallbacksLength = #finallyCallbacks
        if callbacksLength ~= 0 then
            for i = 1, callbacksLength - 1 do
                callbacks[i](callbacks, value)
            end
            if finallyCallbacksLength == 0 then
                return callbacks[callbacksLength](callbacks, value)
            end
            callbacks[callbacksLength](callbacks, value)
        end
        if finallyCallbacksLength ~= 0 then
            for i = 1, finallyCallbacksLength - 1 do
                finallyCallbacks[i](finallyCallbacks)
            end
            return finallyCallbacks[finallyCallbacksLength](finallyCallbacks)
        end
    end
    function __TS__Promise.prototype.createPromiseResolvingCallback(self, f, resolve, reject)
        return function(____, value)
            local success, resultOrError = ____pcall(f, nil, value)
            if not success then
                return reject(nil, resultOrError)
            end
            return self:handleCallbackValue(resultOrError, resolve, reject)
        end
    end
    function __TS__Promise.prototype.handleCallbackValue(self, value, resolve, reject)
        if isPromiseLike(value) then
            local nextpromise = value
            if nextpromise.state == 1 then
                return resolve(nil, nextpromise.value)
            elseif nextpromise.state == 2 then
                return reject(nil, nextpromise.rejectionReason)
            else
                return nextpromise:addCallbacks(resolve, reject)
            end
        else
            return resolve(nil, value)
        end
    end
end

local __TS__AsyncAwaiter, __TS__Await
do
    local ____coroutine = _G.coroutine or ({})
    local cocreate = ____coroutine.create
    local coresume = ____coroutine.resume
    local costatus = ____coroutine.status
    local coyield = ____coroutine.yield
    function __TS__AsyncAwaiter(generator)
        return __TS__New(
            __TS__Promise,
            function(____, resolve, reject)
                local fulfilled, step, resolved, asyncCoroutine
                function fulfilled(self, value)
                    local success, resultOrError = coresume(asyncCoroutine, value)
                    if success then
                        return step(resultOrError)
                    end
                    return reject(nil, resultOrError)
                end
                function step(result)
                    if resolved then
                        return
                    end
                    if costatus(asyncCoroutine) == "dead" then
                        return resolve(nil, result)
                    end
                    return __TS__Promise.resolve(result):addCallbacks(fulfilled, reject)
                end
                resolved = false
                asyncCoroutine = cocreate(generator)
                local success, resultOrError = coresume(
                    asyncCoroutine,
                    function(____, v)
                        resolved = true
                        return __TS__Promise.resolve(v):addCallbacks(resolve, reject)
                    end
                )
                if success then
                    return step(resultOrError)
                else
                    return reject(nil, resultOrError)
                end
            end
        )
    end
    function __TS__Await(thing)
        return coyield(thing)
    end
end

local function __TS__ClassExtends(target, base)
    target.____super = base
    local staticMetatable = setmetatable({__index = base}, base)
    setmetatable(target, staticMetatable)
    local baseMetatable = getmetatable(base)
    if baseMetatable then
        if type(baseMetatable.__index) == "function" then
            staticMetatable.__index = baseMetatable.__index
        end
        if type(baseMetatable.__newindex) == "function" then
            staticMetatable.__newindex = baseMetatable.__newindex
        end
    end
    setmetatable(target.prototype, base.prototype)
    if type(base.prototype.__index) == "function" then
        target.prototype.__index = base.prototype.__index
    end
    if type(base.prototype.__newindex) == "function" then
        target.prototype.__newindex = base.prototype.__newindex
    end
    if type(base.prototype.__tostring) == "function" then
        target.prototype.__tostring = base.prototype.__tostring
    end
end

local function __TS__CloneDescriptor(____bindingPattern0)
    local value
    local writable
    local set
    local get
    local configurable
    local enumerable
    enumerable = ____bindingPattern0.enumerable
    configurable = ____bindingPattern0.configurable
    get = ____bindingPattern0.get
    set = ____bindingPattern0.set
    writable = ____bindingPattern0.writable
    value = ____bindingPattern0.value
    local descriptor = {enumerable = enumerable == true, configurable = configurable == true}
    local hasGetterOrSetter = get ~= nil or set ~= nil
    local hasValueOrWritableAttribute = writable ~= nil or value ~= nil
    if hasGetterOrSetter and hasValueOrWritableAttribute then
        error("Invalid property descriptor. Cannot both specify accessors and a value or writable attribute.", 0)
    end
    if get or set then
        descriptor.get = get
        descriptor.set = set
    else
        descriptor.value = value
        descriptor.writable = writable == true
    end
    return descriptor
end

local function __TS__Decorate(self, originalValue, decorators, context)
    local result = originalValue
    do
        local i = #decorators
        while i >= 0 do
            local decorator = decorators[i + 1]
            if decorator ~= nil then
                local ____decorator_result_0 = decorator(self, result, context)
                if ____decorator_result_0 == nil then
                    ____decorator_result_0 = result
                end
                result = ____decorator_result_0
            end
            i = i - 1
        end
    end
    return result
end

local function __TS__ObjectAssign(target, ...)
    local sources = {...}
    for i = 1, #sources do
        local source = sources[i]
        for key in pairs(source) do
            target[key] = source[key]
        end
    end
    return target
end

local function __TS__ObjectGetOwnPropertyDescriptor(object, key)
    local metatable = getmetatable(object)
    if not metatable then
        return
    end
    if not rawget(metatable, "_descriptors") then
        return
    end
    return rawget(metatable, "_descriptors")[key]
end

local __TS__DescriptorGet
do
    local getmetatable = _G.getmetatable
    local ____rawget = _G.rawget
    function __TS__DescriptorGet(self, metatable, key)
        while metatable do
            local rawResult = ____rawget(metatable, key)
            if rawResult ~= nil then
                return rawResult
            end
            local descriptors = ____rawget(metatable, "_descriptors")
            if descriptors then
                local descriptor = descriptors[key]
                if descriptor ~= nil then
                    if descriptor.get then
                        return descriptor.get(self)
                    end
                    return descriptor.value
                end
            end
            metatable = getmetatable(metatable)
        end
    end
end

local __TS__DescriptorSet
do
    local getmetatable = _G.getmetatable
    local ____rawget = _G.rawget
    local rawset = _G.rawset
    function __TS__DescriptorSet(self, metatable, key, value)
        while metatable do
            local descriptors = ____rawget(metatable, "_descriptors")
            if descriptors then
                local descriptor = descriptors[key]
                if descriptor ~= nil then
                    if descriptor.set then
                        descriptor.set(self, value)
                    else
                        if descriptor.writable == false then
                            error(
                                ((("Cannot assign to read only property '" .. key) .. "' of object '") .. tostring(self)) .. "'",
                                0
                            )
                        end
                        descriptor.value = value
                    end
                    return
                end
            end
            metatable = getmetatable(metatable)
        end
        rawset(self, key, value)
    end
end

local __TS__SetDescriptor
do
    local getmetatable = _G.getmetatable
    local function descriptorIndex(self, key)
        return __TS__DescriptorGet(
            self,
            getmetatable(self),
            key
        )
    end
    local function descriptorNewIndex(self, key, value)
        return __TS__DescriptorSet(
            self,
            getmetatable(self),
            key,
            value
        )
    end
    function __TS__SetDescriptor(target, key, desc, isPrototype)
        if isPrototype == nil then
            isPrototype = false
        end
        local ____isPrototype_0
        if isPrototype then
            ____isPrototype_0 = target
        else
            ____isPrototype_0 = getmetatable(target)
        end
        local metatable = ____isPrototype_0
        if not metatable then
            metatable = {}
            setmetatable(target, metatable)
        end
        local value = rawget(target, key)
        if value ~= nil then
            rawset(target, key, nil)
        end
        if not rawget(metatable, "_descriptors") then
            metatable._descriptors = {}
        end
        metatable._descriptors[key] = __TS__CloneDescriptor(desc)
        metatable.__index = descriptorIndex
        metatable.__newindex = descriptorNewIndex
    end
end

local function __TS__DecorateLegacy(decorators, target, key, desc)
    local result = target
    do
        local i = #decorators
        while i >= 0 do
            local decorator = decorators[i + 1]
            if decorator ~= nil then
                local oldResult = result
                if key == nil then
                    result = decorator(nil, result)
                elseif desc == true then
                    local value = rawget(target, key)
                    local descriptor = __TS__ObjectGetOwnPropertyDescriptor(target, key) or ({configurable = true, writable = true, value = value})
                    local desc = decorator(nil, target, key, descriptor) or descriptor
                    local isSimpleValue = desc.configurable == true and desc.writable == true and not desc.get and not desc.set
                    if isSimpleValue then
                        rawset(target, key, desc.value)
                    else
                        __TS__SetDescriptor(
                            target,
                            key,
                            __TS__ObjectAssign({}, descriptor, desc)
                        )
                    end
                elseif desc == false then
                    result = decorator(nil, target, key, desc)
                else
                    result = decorator(nil, target, key)
                end
                result = result or oldResult
            end
            i = i - 1
        end
    end
    return result
end

local function __TS__DecorateParam(paramIndex, decorator)
    return function(____, target, key) return decorator(nil, target, key, paramIndex) end
end

local function __TS__StringIncludes(self, searchString, position)
    if not position then
        position = 1
    else
        position = position + 1
    end
    local index = string.find(self, searchString, position, true)
    return index ~= nil
end

local Error, RangeError, ReferenceError, SyntaxError, TypeError, URIError
do
    local function getErrorStack(self, constructor)
        if debug == nil then
            return nil
        end
        local level = 1
        while true do
            local info = debug.getinfo(level, "f")
            level = level + 1
            if not info then
                level = 1
                break
            elseif info.func == constructor then
                break
            end
        end
        if __TS__StringIncludes(_VERSION, "Lua 5.0") then
            return debug.traceback(("[Level " .. tostring(level)) .. "]")
        elseif _VERSION == "Lua 5.1" then
            return string.sub(
                debug.traceback("", level),
                2
            )
        else
            return debug.traceback(nil, level)
        end
    end
    local function wrapErrorToString(self, getDescription)
        return function(self)
            local description = getDescription(self)
            local caller = debug.getinfo(3, "f")
            local isClassicLua = __TS__StringIncludes(_VERSION, "Lua 5.0")
            if isClassicLua or caller and caller.func ~= error then
                return description
            else
                return (description .. "\n") .. tostring(self.stack)
            end
        end
    end
    local function initErrorClass(self, Type, name)
        Type.name = name
        return setmetatable(
            Type,
            {__call = function(____, _self, message) return __TS__New(Type, message) end}
        )
    end
    local ____initErrorClass_1 = initErrorClass
    local ____class_0 = __TS__Class()
    ____class_0.name = ""
    function ____class_0.prototype.____constructor(self, message)
        if message == nil then
            message = ""
        end
        self.message = message
        self.name = "Error"
        self.stack = getErrorStack(nil, __TS__New)
        local metatable = getmetatable(self)
        if metatable and not metatable.__errorToStringPatched then
            metatable.__errorToStringPatched = true
            metatable.__tostring = wrapErrorToString(nil, metatable.__tostring)
        end
    end
    function ____class_0.prototype.__tostring(self)
        return self.message ~= "" and (self.name .. ": ") .. self.message or self.name
    end
    Error = ____initErrorClass_1(nil, ____class_0, "Error")
    local function createErrorClass(self, name)
        local ____initErrorClass_3 = initErrorClass
        local ____class_2 = __TS__Class()
        ____class_2.name = ____class_2.name
        __TS__ClassExtends(____class_2, Error)
        function ____class_2.prototype.____constructor(self, ...)
            ____class_2.____super.prototype.____constructor(self, ...)
            self.name = name
        end
        return ____initErrorClass_3(nil, ____class_2, name)
    end
    RangeError = createErrorClass(nil, "RangeError")
    ReferenceError = createErrorClass(nil, "ReferenceError")
    SyntaxError = createErrorClass(nil, "SyntaxError")
    TypeError = createErrorClass(nil, "TypeError")
    URIError = createErrorClass(nil, "URIError")
end

local function __TS__ObjectGetOwnPropertyDescriptors(object)
    local metatable = getmetatable(object)
    if not metatable then
        return {}
    end
    return rawget(metatable, "_descriptors") or ({})
end

local function __TS__Delete(target, key)
    local descriptors = __TS__ObjectGetOwnPropertyDescriptors(target)
    local descriptor = descriptors[key]
    if descriptor then
        if not descriptor.configurable then
            error(
                __TS__New(
                    TypeError,
                    ((("Cannot delete property " .. tostring(key)) .. " of ") .. tostring(target)) .. "."
                ),
                0
            )
        end
        descriptors[key] = nil
        return true
    end
    target[key] = nil
    return true
end

local function __TS__StringAccess(self, index)
    if index >= 0 and index < #self then
        return string.sub(self, index + 1, index + 1)
    end
end

local function __TS__DelegatedYield(iterable)
    if type(iterable) == "string" then
        for index = 0, #iterable - 1 do
            coroutine.yield(__TS__StringAccess(iterable, index))
        end
    elseif iterable.____coroutine ~= nil then
        local co = iterable.____coroutine
        while true do
            local status, value = coroutine.resume(co)
            if not status then
                error(value, 0)
            end
            if coroutine.status(co) == "dead" then
                return value
            else
                coroutine.yield(value)
            end
        end
    elseif iterable[Symbol.iterator] then
        local iterator = iterable[Symbol.iterator](iterable)
        while true do
            local result = iterator:next()
            if result.done then
                return result.value
            else
                coroutine.yield(result.value)
            end
        end
    else
        for ____, value in ipairs(iterable) do
            coroutine.yield(value)
        end
    end
end

local function __TS__FunctionBind(fn, ...)
    local boundArgs = {...}
    return function(____, ...)
        local args = {...}
        __TS__ArrayUnshift(
            args,
            __TS__Unpack(boundArgs)
        )
        return fn(__TS__Unpack(args))
    end
end

local __TS__Generator
do
    local function generatorIterator(self)
        return self
    end
    local function generatorNext(self, ...)
        local co = self.____coroutine
        if coroutine.status(co) == "dead" then
            return {done = true}
        end
        local status, value = coroutine.resume(co, ...)
        if not status then
            error(value, 0)
        end
        return {
            value = value,
            done = coroutine.status(co) == "dead"
        }
    end
    function __TS__Generator(fn)
        return function(...)
            local args = {...}
            local argsLength = __TS__CountVarargs(...)
            return {
                ____coroutine = coroutine.create(function() return fn(__TS__Unpack(args, 1, argsLength)) end),
                [Symbol.iterator] = generatorIterator,
                next = generatorNext
            }
        end
    end
end

local function __TS__InstanceOfObject(value)
    local valueType = type(value)
    return valueType == "table" or valueType == "function"
end

local function __TS__LuaIteratorSpread(self, state, firstKey)
    local results = {}
    local key, value = self(state, firstKey)
    while key do
        results[#results + 1] = {key, value}
        key, value = self(state, key)
    end
    return __TS__Unpack(results)
end

local Map
do
    Map = __TS__Class()
    Map.name = "Map"
    function Map.prototype.____constructor(self, entries)
        self[Symbol.toStringTag] = "Map"
        self.items = {}
        self.size = 0
        self.nextKey = {}
        self.previousKey = {}
        if entries == nil then
            return
        end
        local iterable = entries
        if iterable[Symbol.iterator] then
            local iterator = iterable[Symbol.iterator](iterable)
            while true do
                local result = iterator:next()
                if result.done then
                    break
                end
                local value = result.value
                self:set(value[1], value[2])
            end
        else
            local array = entries
            for ____, kvp in ipairs(array) do
                self:set(kvp[1], kvp[2])
            end
        end
    end
    function Map.prototype.clear(self)
        self.items = {}
        self.nextKey = {}
        self.previousKey = {}
        self.firstKey = nil
        self.lastKey = nil
        self.size = 0
    end
    function Map.prototype.delete(self, key)
        local contains = self:has(key)
        if contains then
            self.size = self.size - 1
            local next = self.nextKey[key]
            local previous = self.previousKey[key]
            if next ~= nil and previous ~= nil then
                self.nextKey[previous] = next
                self.previousKey[next] = previous
            elseif next ~= nil then
                self.firstKey = next
                self.previousKey[next] = nil
            elseif previous ~= nil then
                self.lastKey = previous
                self.nextKey[previous] = nil
            else
                self.firstKey = nil
                self.lastKey = nil
            end
            self.nextKey[key] = nil
            self.previousKey[key] = nil
        end
        self.items[key] = nil
        return contains
    end
    function Map.prototype.forEach(self, callback)
        for ____, key in __TS__Iterator(self:keys()) do
            callback(nil, self.items[key], key, self)
        end
    end
    function Map.prototype.get(self, key)
        return self.items[key]
    end
    function Map.prototype.has(self, key)
        return self.nextKey[key] ~= nil or self.lastKey == key
    end
    function Map.prototype.set(self, key, value)
        local isNewValue = not self:has(key)
        if isNewValue then
            self.size = self.size + 1
        end
        self.items[key] = value
        if self.firstKey == nil then
            self.firstKey = key
            self.lastKey = key
        elseif isNewValue then
            self.nextKey[self.lastKey] = key
            self.previousKey[key] = self.lastKey
            self.lastKey = key
        end
        return self
    end
    Map.prototype[Symbol.iterator] = function(self)
        return self:entries()
    end
    function Map.prototype.entries(self)
        local items = self.items
        local nextKey = self.nextKey
        local key = self.firstKey
        return {
            [Symbol.iterator] = function(self)
                return self
            end,
            next = function(self)
                local result = {done = not key, value = {key, items[key]}}
                key = nextKey[key]
                return result
            end
        }
    end
    function Map.prototype.keys(self)
        local nextKey = self.nextKey
        local key = self.firstKey
        return {
            [Symbol.iterator] = function(self)
                return self
            end,
            next = function(self)
                local result = {done = not key, value = key}
                key = nextKey[key]
                return result
            end
        }
    end
    function Map.prototype.values(self)
        local items = self.items
        local nextKey = self.nextKey
        local key = self.firstKey
        return {
            [Symbol.iterator] = function(self)
                return self
            end,
            next = function(self)
                local result = {done = not key, value = items[key]}
                key = nextKey[key]
                return result
            end
        }
    end
    Map[Symbol.species] = Map
end

local function __TS__MapGroupBy(items, keySelector)
    local result = __TS__New(Map)
    local i = 0
    for ____, item in __TS__Iterator(items) do
        local key = keySelector(nil, item, i)
        if result:has(key) then
            local ____temp_0 = result:get(key)
            ____temp_0[#____temp_0 + 1] = item
        else
            result:set(key, {item})
        end
        i = i + 1
    end
    return result
end

local __TS__Match = string.match

local __TS__MathAtan2 = math.atan2 or math.atan

local __TS__MathModf = math.modf

local function __TS__NumberIsNaN(value)
    return value ~= value
end

local function __TS__MathSign(val)
    if __TS__NumberIsNaN(val) or val == 0 then
        return val
    end
    if val < 0 then
        return -1
    end
    return 1
end

local function __TS__NumberIsFinite(value)
    return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

local function __TS__MathTrunc(val)
    if not __TS__NumberIsFinite(val) or val == 0 then
        return val
    end
    return val > 0 and math.floor(val) or math.ceil(val)
end

local function __TS__Number(value)
    local valueType = type(value)
    if valueType == "number" then
        return value
    elseif valueType == "string" then
        local numberValue = tonumber(value)
        if numberValue then
            return numberValue
        end
        if value == "Infinity" then
            return math.huge
        end
        if value == "-Infinity" then
            return -math.huge
        end
        local stringWithoutSpaces = string.gsub(value, "%s", "")
        if stringWithoutSpaces == "" then
            return 0
        end
        return 0 / 0
    elseif valueType == "boolean" then
        return value and 1 or 0
    else
        return 0 / 0
    end
end

local function __TS__NumberIsInteger(value)
    return __TS__NumberIsFinite(value) and math.floor(value) == value
end

local function __TS__StringSubstring(self, start, ____end)
    if ____end ~= ____end then
        ____end = 0
    end
    if ____end ~= nil and start > ____end then
        start, ____end = ____end, start
    end
    if start >= 0 then
        start = start + 1
    else
        start = 1
    end
    if ____end ~= nil and ____end < 0 then
        ____end = 0
    end
    return string.sub(self, start, ____end)
end

local __TS__ParseInt
do
    local parseIntBasePattern = "0123456789aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTvVwWxXyYzZ"
    function __TS__ParseInt(numberString, base)
        if base == nil then
            base = 10
            local hexMatch = __TS__Match(numberString, "^%s*-?0[xX]")
            if hexMatch ~= nil then
                base = 16
                numberString = (__TS__Match(hexMatch, "-")) and "-" .. __TS__StringSubstring(numberString, #hexMatch) or __TS__StringSubstring(numberString, #hexMatch)
            end
        end
        if base < 2 or base > 36 then
            return 0 / 0
        end
        local allowedDigits = base <= 10 and __TS__StringSubstring(parseIntBasePattern, 0, base) or __TS__StringSubstring(parseIntBasePattern, 0, 10 + 2 * (base - 10))
        local pattern = ("^%s*(-?[" .. allowedDigits) .. "]*)"
        local number = tonumber((__TS__Match(numberString, pattern)), base)
        if number == nil then
            return 0 / 0
        end
        if number >= 0 then
            return math.floor(number)
        else
            return math.ceil(number)
        end
    end
end

local function __TS__ParseFloat(numberString)
    local infinityMatch = __TS__Match(numberString, "^%s*(-?Infinity)")
    if infinityMatch ~= nil then
        return __TS__StringAccess(infinityMatch, 0) == "-" and -math.huge or math.huge
    end
    local number = tonumber((__TS__Match(numberString, "^%s*(-?%d+%.?%d*)")))
    return number or 0 / 0
end

local __TS__NumberToString
do
    local radixChars = "0123456789abcdefghijklmnopqrstuvwxyz"
    function __TS__NumberToString(self, radix)
        if radix == nil or radix == 10 or self == math.huge or self == -math.huge or self ~= self then
            return tostring(self)
        end
        radix = math.floor(radix)
        if radix < 2 or radix > 36 then
            error("toString() radix argument must be between 2 and 36", 0)
        end
        local integer, fraction = __TS__MathModf(math.abs(self))
        local result = ""
        if radix == 8 then
            result = string.format("%o", integer)
        elseif radix == 16 then
            result = string.format("%x", integer)
        else
            repeat
                do
                    result = __TS__StringAccess(radixChars, integer % radix) .. result
                    integer = math.floor(integer / radix)
                end
            until not (integer ~= 0)
        end
        if fraction ~= 0 then
            result = result .. "."
            local delta = 1e-16
            repeat
                do
                    fraction = fraction * radix
                    delta = delta * radix
                    local digit = math.floor(fraction)
                    result = result .. __TS__StringAccess(radixChars, digit)
                    fraction = fraction - digit
                end
            until not (fraction >= delta)
        end
        if self < 0 then
            result = "-" .. result
        end
        return result
    end
end

local function __TS__NumberToFixed(self, fractionDigits)
    if math.abs(self) >= 1e+21 or self ~= self then
        return tostring(self)
    end
    local f = math.floor(fractionDigits or 0)
    if f < 0 or f > 99 then
        error("toFixed() digits argument must be between 0 and 99", 0)
    end
    return string.format(
        ("%." .. tostring(f)) .. "f",
        self
    )
end

local function __TS__ObjectDefineProperty(target, key, desc)
    local luaKey = type(key) == "number" and key + 1 or key
    local value = rawget(target, luaKey)
    local hasGetterOrSetter = desc.get ~= nil or desc.set ~= nil
    local descriptor
    if hasGetterOrSetter then
        if value ~= nil then
            error(
                "Cannot redefine property: " .. tostring(key),
                0
            )
        end
        descriptor = desc
    else
        local valueExists = value ~= nil
        local ____desc_set_4 = desc.set
        local ____desc_get_5 = desc.get
        local ____desc_configurable_0 = desc.configurable
        if ____desc_configurable_0 == nil then
            ____desc_configurable_0 = valueExists
        end
        local ____desc_enumerable_1 = desc.enumerable
        if ____desc_enumerable_1 == nil then
            ____desc_enumerable_1 = valueExists
        end
        local ____desc_writable_2 = desc.writable
        if ____desc_writable_2 == nil then
            ____desc_writable_2 = valueExists
        end
        local ____temp_3
        if desc.value ~= nil then
            ____temp_3 = desc.value
        else
            ____temp_3 = value
        end
        descriptor = {
            set = ____desc_set_4,
            get = ____desc_get_5,
            configurable = ____desc_configurable_0,
            enumerable = ____desc_enumerable_1,
            writable = ____desc_writable_2,
            value = ____temp_3
        }
    end
    __TS__SetDescriptor(target, luaKey, descriptor)
    return target
end

local function __TS__ObjectEntries(obj)
    local result = {}
    local len = 0
    for key in pairs(obj) do
        len = len + 1
        result[len] = {key, obj[key]}
    end
    return result
end

local function __TS__ObjectFromEntries(entries)
    local obj = {}
    local iterable = entries
    if iterable[Symbol.iterator] then
        local iterator = iterable[Symbol.iterator](iterable)
        while true do
            local result = iterator:next()
            if result.done then
                break
            end
            local value = result.value
            obj[value[1]] = value[2]
        end
    else
        for ____, entry in ipairs(entries) do
            obj[entry[1]] = entry[2]
        end
    end
    return obj
end

local function __TS__ObjectGroupBy(items, keySelector)
    local result = {}
    local i = 0
    for ____, item in __TS__Iterator(items) do
        local key = keySelector(nil, item, i)
        if result[key] ~= nil then
            local ____result_key_0 = result[key]
            ____result_key_0[#____result_key_0 + 1] = item
        else
            result[key] = {item}
        end
        i = i + 1
    end
    return result
end

local function __TS__ObjectKeys(obj)
    local result = {}
    local len = 0
    for key in pairs(obj) do
        len = len + 1
        result[len] = key
    end
    return result
end

local function __TS__ObjectRest(target, usedProperties)
    local result = {}
    for property in pairs(target) do
        if not usedProperties[property] then
            result[property] = target[property]
        end
    end
    return result
end

local function __TS__ObjectValues(obj)
    local result = {}
    local len = 0
    for key in pairs(obj) do
        len = len + 1
        result[len] = obj[key]
    end
    return result
end

local function __TS__PromiseAll(iterable)
    local results = {}
    local toResolve = {}
    local numToResolve = 0
    local i = 0
    for ____, item in __TS__Iterator(iterable) do
        if __TS__InstanceOf(item, __TS__Promise) then
            if item.state == 1 then
                results[i + 1] = item.value
            elseif item.state == 2 then
                return __TS__Promise.reject(item.rejectionReason)
            else
                numToResolve = numToResolve + 1
                toResolve[i] = item
            end
        else
            results[i + 1] = item
        end
        i = i + 1
    end
    if numToResolve == 0 then
        return __TS__Promise.resolve(results)
    end
    return __TS__New(
        __TS__Promise,
        function(____, resolve, reject)
            for index, promise in pairs(toResolve) do
                promise["then"](
                    promise,
                    function(____, data)
                        results[index + 1] = data
                        numToResolve = numToResolve - 1
                        if numToResolve == 0 then
                            resolve(nil, results)
                        end
                    end,
                    function(____, reason)
                        reject(nil, reason)
                    end
                )
            end
        end
    )
end

local function __TS__PromiseAllSettled(iterable)
    local results = {}
    local toResolve = {}
    local numToResolve = 0
    local i = 0
    for ____, item in __TS__Iterator(iterable) do
        if __TS__InstanceOf(item, __TS__Promise) then
            if item.state == 1 then
                results[i + 1] = {status = "fulfilled", value = item.value}
            elseif item.state == 2 then
                results[i + 1] = {status = "rejected", reason = item.rejectionReason}
            else
                numToResolve = numToResolve + 1
                toResolve[i] = item
            end
        else
            results[i + 1] = {status = "fulfilled", value = item}
        end
        i = i + 1
    end
    if numToResolve == 0 then
        return __TS__Promise.resolve(results)
    end
    return __TS__New(
        __TS__Promise,
        function(____, resolve)
            for index, promise in pairs(toResolve) do
                promise["then"](
                    promise,
                    function(____, data)
                        results[index + 1] = {status = "fulfilled", value = data}
                        numToResolve = numToResolve - 1
                        if numToResolve == 0 then
                            resolve(nil, results)
                        end
                    end,
                    function(____, reason)
                        results[index + 1] = {status = "rejected", reason = reason}
                        numToResolve = numToResolve - 1
                        if numToResolve == 0 then
                            resolve(nil, results)
                        end
                    end
                )
            end
        end
    )
end

local function __TS__PromiseAny(iterable)
    local rejections = {}
    local pending = {}
    for ____, item in __TS__Iterator(iterable) do
        if __TS__InstanceOf(item, __TS__Promise) then
            if item.state == 1 then
                return __TS__Promise.resolve(item.value)
            elseif item.state == 2 then
                rejections[#rejections + 1] = item.rejectionReason
            else
                pending[#pending + 1] = item
            end
        else
            return __TS__Promise.resolve(item)
        end
    end
    if #pending == 0 then
        return __TS__Promise.reject("No promises to resolve with .any()")
    end
    local numResolved = 0
    return __TS__New(
        __TS__Promise,
        function(____, resolve, reject)
            for ____, promise in ipairs(pending) do
                promise["then"](
                    promise,
                    function(____, data)
                        resolve(nil, data)
                    end,
                    function(____, reason)
                        rejections[#rejections + 1] = reason
                        numResolved = numResolved + 1
                        if numResolved == #pending then
                            reject(nil, {name = "AggregateError", message = "All Promises rejected", errors = rejections})
                        end
                    end
                )
            end
        end
    )
end

local function __TS__PromiseRace(iterable)
    local pending = {}
    for ____, item in __TS__Iterator(iterable) do
        if __TS__InstanceOf(item, __TS__Promise) then
            if item.state == 1 then
                return __TS__Promise.resolve(item.value)
            elseif item.state == 2 then
                return __TS__Promise.reject(item.rejectionReason)
            else
                pending[#pending + 1] = item
            end
        else
            return __TS__Promise.resolve(item)
        end
    end
    return __TS__New(
        __TS__Promise,
        function(____, resolve, reject)
            for ____, promise in ipairs(pending) do
                promise["then"](
                    promise,
                    function(____, value) return resolve(nil, value) end,
                    function(____, reason) return reject(nil, reason) end
                )
            end
        end
    )
end

local Set
do
    Set = __TS__Class()
    Set.name = "Set"
    function Set.prototype.____constructor(self, values)
        self[Symbol.toStringTag] = "Set"
        self.size = 0
        self.nextKey = {}
        self.previousKey = {}
        if values == nil then
            return
        end
        local iterable = values
        if iterable[Symbol.iterator] then
            local iterator = iterable[Symbol.iterator](iterable)
            while true do
                local result = iterator:next()
                if result.done then
                    break
                end
                self:add(result.value)
            end
        else
            local array = values
            for ____, value in ipairs(array) do
                self:add(value)
            end
        end
    end
    function Set.prototype.add(self, value)
        local isNewValue = not self:has(value)
        if isNewValue then
            self.size = self.size + 1
        end
        if self.firstKey == nil then
            self.firstKey = value
            self.lastKey = value
        elseif isNewValue then
            self.nextKey[self.lastKey] = value
            self.previousKey[value] = self.lastKey
            self.lastKey = value
        end
        return self
    end
    function Set.prototype.clear(self)
        self.nextKey = {}
        self.previousKey = {}
        self.firstKey = nil
        self.lastKey = nil
        self.size = 0
    end
    function Set.prototype.delete(self, value)
        local contains = self:has(value)
        if contains then
            self.size = self.size - 1
            local next = self.nextKey[value]
            local previous = self.previousKey[value]
            if next ~= nil and previous ~= nil then
                self.nextKey[previous] = next
                self.previousKey[next] = previous
            elseif next ~= nil then
                self.firstKey = next
                self.previousKey[next] = nil
            elseif previous ~= nil then
                self.lastKey = previous
                self.nextKey[previous] = nil
            else
                self.firstKey = nil
                self.lastKey = nil
            end
            self.nextKey[value] = nil
            self.previousKey[value] = nil
        end
        return contains
    end
    function Set.prototype.forEach(self, callback)
        for ____, key in __TS__Iterator(self:keys()) do
            callback(nil, key, key, self)
        end
    end
    function Set.prototype.has(self, value)
        return self.nextKey[value] ~= nil or self.lastKey == value
    end
    Set.prototype[Symbol.iterator] = function(self)
        return self:values()
    end
    function Set.prototype.entries(self)
        local nextKey = self.nextKey
        local key = self.firstKey
        return {
            [Symbol.iterator] = function(self)
                return self
            end,
            next = function(self)
                local result = {done = not key, value = {key, key}}
                key = nextKey[key]
                return result
            end
        }
    end
    function Set.prototype.keys(self)
        local nextKey = self.nextKey
        local key = self.firstKey
        return {
            [Symbol.iterator] = function(self)
                return self
            end,
            next = function(self)
                local result = {done = not key, value = key}
                key = nextKey[key]
                return result
            end
        }
    end
    function Set.prototype.values(self)
        local nextKey = self.nextKey
        local key = self.firstKey
        return {
            [Symbol.iterator] = function(self)
                return self
            end,
            next = function(self)
                local result = {done = not key, value = key}
                key = nextKey[key]
                return result
            end
        }
    end
    function Set.prototype.union(self, other)
        local result = __TS__New(Set, self)
        for ____, item in __TS__Iterator(other) do
            result:add(item)
        end
        return result
    end
    function Set.prototype.intersection(self, other)
        local result = __TS__New(Set)
        for ____, item in __TS__Iterator(self) do
            if other:has(item) then
                result:add(item)
            end
        end
        return result
    end
    function Set.prototype.difference(self, other)
        local result = __TS__New(Set, self)
        for ____, item in __TS__Iterator(other) do
            result:delete(item)
        end
        return result
    end
    function Set.prototype.symmetricDifference(self, other)
        local result = __TS__New(Set, self)
        for ____, item in __TS__Iterator(other) do
            if self:has(item) then
                result:delete(item)
            else
                result:add(item)
            end
        end
        return result
    end
    function Set.prototype.isSubsetOf(self, other)
        for ____, item in __TS__Iterator(self) do
            if not other:has(item) then
                return false
            end
        end
        return true
    end
    function Set.prototype.isSupersetOf(self, other)
        for ____, item in __TS__Iterator(other) do
            if not self:has(item) then
                return false
            end
        end
        return true
    end
    function Set.prototype.isDisjointFrom(self, other)
        for ____, item in __TS__Iterator(self) do
            if other:has(item) then
                return false
            end
        end
        return true
    end
    Set[Symbol.species] = Set
end

local function __TS__SparseArrayNew(...)
    local sparseArray = {...}
    sparseArray.sparseLength = __TS__CountVarargs(...)
    return sparseArray
end

local function __TS__SparseArrayPush(sparseArray, ...)
    local args = {...}
    local argsLen = __TS__CountVarargs(...)
    local listLen = sparseArray.sparseLength
    for i = 1, argsLen do
        sparseArray[listLen + i] = args[i]
    end
    sparseArray.sparseLength = listLen + argsLen
end

local function __TS__SparseArraySpread(sparseArray)
    local _unpack = unpack or table.unpack
    return _unpack(sparseArray, 1, sparseArray.sparseLength)
end

local WeakMap
do
    WeakMap = __TS__Class()
    WeakMap.name = "WeakMap"
    function WeakMap.prototype.____constructor(self, entries)
        self[Symbol.toStringTag] = "WeakMap"
        self.items = {}
        setmetatable(self.items, {__mode = "k"})
        if entries == nil then
            return
        end
        local iterable = entries
        if iterable[Symbol.iterator] then
            local iterator = iterable[Symbol.iterator](iterable)
            while true do
                local result = iterator:next()
                if result.done then
                    break
                end
                local value = result.value
                self.items[value[1]] = value[2]
            end
        else
            for ____, kvp in ipairs(entries) do
                self.items[kvp[1]] = kvp[2]
            end
        end
    end
    function WeakMap.prototype.delete(self, key)
        local contains = self:has(key)
        self.items[key] = nil
        return contains
    end
    function WeakMap.prototype.get(self, key)
        return self.items[key]
    end
    function WeakMap.prototype.has(self, key)
        return self.items[key] ~= nil
    end
    function WeakMap.prototype.set(self, key, value)
        self.items[key] = value
        return self
    end
    WeakMap[Symbol.species] = WeakMap
end

local WeakSet
do
    WeakSet = __TS__Class()
    WeakSet.name = "WeakSet"
    function WeakSet.prototype.____constructor(self, values)
        self[Symbol.toStringTag] = "WeakSet"
        self.items = {}
        setmetatable(self.items, {__mode = "k"})
        if values == nil then
            return
        end
        local iterable = values
        if iterable[Symbol.iterator] then
            local iterator = iterable[Symbol.iterator](iterable)
            while true do
                local result = iterator:next()
                if result.done then
                    break
                end
                self.items[result.value] = true
            end
        else
            for ____, value in ipairs(values) do
                self.items[value] = true
            end
        end
    end
    function WeakSet.prototype.add(self, value)
        self.items[value] = true
        return self
    end
    function WeakSet.prototype.delete(self, value)
        local contains = self:has(value)
        self.items[value] = nil
        return contains
    end
    function WeakSet.prototype.has(self, value)
        return self.items[value] == true
    end
    WeakSet[Symbol.species] = WeakSet
end

local function __TS__SourceMapTraceBack(fileName, sourceMap)
    _G.__TS__sourcemap = _G.__TS__sourcemap or ({})
    _G.__TS__sourcemap[fileName] = sourceMap
    if _G.__TS__originalTraceback == nil then
        local originalTraceback = debug.traceback
        _G.__TS__originalTraceback = originalTraceback
        debug.traceback = function(thread, message, level)
            local trace
            if thread == nil and message == nil and level == nil then
                trace = originalTraceback()
            elseif __TS__StringIncludes(_VERSION, "Lua 5.0") then
                trace = originalTraceback((("[Level " .. tostring(level)) .. "] ") .. tostring(message))
            else
                trace = originalTraceback(thread, message, level)
            end
            if type(trace) ~= "string" then
                return trace
            end
            local function replacer(____, file, srcFile, line)
                local fileSourceMap = _G.__TS__sourcemap[file]
                if fileSourceMap ~= nil and fileSourceMap[line] ~= nil then
                    local data = fileSourceMap[line]
                    if type(data) == "number" then
                        return (srcFile .. ":") .. tostring(data)
                    end
                    return (data.file .. ":") .. tostring(data.line)
                end
                return (file .. ":") .. line
            end
            local result = string.gsub(
                trace,
                "([^%s<]+)%.lua:(%d+)",
                function(file, line) return replacer(nil, file .. ".lua", file .. ".ts", line) end
            )
            local function stringReplacer(____, file, line)
                local fileSourceMap = _G.__TS__sourcemap[file]
                if fileSourceMap ~= nil and fileSourceMap[line] ~= nil then
                    local chunkName = (__TS__Match(file, "%[string \"([^\"]+)\"%]"))
                    local sourceName = string.gsub(chunkName, ".lua$", ".ts")
                    local data = fileSourceMap[line]
                    if type(data) == "number" then
                        return (sourceName .. ":") .. tostring(data)
                    end
                    return (data.file .. ":") .. tostring(data.line)
                end
                return (file .. ":") .. line
            end
            result = string.gsub(
                result,
                "(%[string \"[^\"]+\"%]):(%d+)",
                function(file, line) return stringReplacer(nil, file, line) end
            )
            return result
        end
    end
end

local function __TS__Spread(iterable)
    local arr = {}
    if type(iterable) == "string" then
        for i = 0, #iterable - 1 do
            arr[i + 1] = __TS__StringAccess(iterable, i)
        end
    else
        local len = 0
        for ____, item in __TS__Iterator(iterable) do
            len = len + 1
            arr[len] = item
        end
    end
    return __TS__Unpack(arr)
end

local function __TS__StringCharAt(self, pos)
    if pos ~= pos then
        pos = 0
    end
    if pos < 0 then
        return ""
    end
    return string.sub(self, pos + 1, pos + 1)
end

local function __TS__StringCharCodeAt(self, index)
    if index ~= index then
        index = 0
    end
    if index < 0 then
        return 0 / 0
    end
    return string.byte(self, index + 1) or 0 / 0
end

local function __TS__StringEndsWith(self, searchString, endPosition)
    if endPosition == nil or endPosition > #self then
        endPosition = #self
    end
    return string.sub(self, endPosition - #searchString + 1, endPosition) == searchString
end

local function __TS__StringPadEnd(self, maxLength, fillString)
    if fillString == nil then
        fillString = " "
    end
    if maxLength ~= maxLength then
        maxLength = 0
    end
    if maxLength == -math.huge or maxLength == math.huge then
        error("Invalid string length", 0)
    end
    if #self >= maxLength or #fillString == 0 then
        return self
    end
    maxLength = maxLength - #self
    if maxLength > #fillString then
        fillString = fillString .. string.rep(
            fillString,
            math.floor(maxLength / #fillString)
        )
    end
    return self .. string.sub(
        fillString,
        1,
        math.floor(maxLength)
    )
end

local function __TS__StringPadStart(self, maxLength, fillString)
    if fillString == nil then
        fillString = " "
    end
    if maxLength ~= maxLength then
        maxLength = 0
    end
    if maxLength == -math.huge or maxLength == math.huge then
        error("Invalid string length", 0)
    end
    if #self >= maxLength or #fillString == 0 then
        return self
    end
    maxLength = maxLength - #self
    if maxLength > #fillString then
        fillString = fillString .. string.rep(
            fillString,
            math.floor(maxLength / #fillString)
        )
    end
    return string.sub(
        fillString,
        1,
        math.floor(maxLength)
    ) .. self
end

local __TS__StringReplace
do
    local sub = string.sub
    function __TS__StringReplace(source, searchValue, replaceValue)
        local startPos, endPos = string.find(source, searchValue, nil, true)
        if not startPos then
            return source
        end
        local before = sub(source, 1, startPos - 1)
        local replacement = type(replaceValue) == "string" and replaceValue or replaceValue(nil, searchValue, startPos - 1, source)
        local after = sub(source, endPos + 1)
        return (before .. replacement) .. after
    end
end

local __TS__StringSplit
do
    local sub = string.sub
    local find = string.find
    function __TS__StringSplit(source, separator, limit)
        if limit == nil then
            limit = 4294967295
        end
        if limit == 0 then
            return {}
        end
        local result = {}
        local resultIndex = 1
        if separator == nil or separator == "" then
            for i = 1, #source do
                result[resultIndex] = sub(source, i, i)
                resultIndex = resultIndex + 1
            end
        else
            local currentPos = 1
            while resultIndex <= limit do
                local startPos, endPos = find(source, separator, currentPos, true)
                if not startPos then
                    break
                end
                result[resultIndex] = sub(source, currentPos, startPos - 1)
                resultIndex = resultIndex + 1
                currentPos = endPos + 1
            end
            if resultIndex <= limit then
                result[resultIndex] = sub(source, currentPos)
            end
        end
        return result
    end
end

local __TS__StringReplaceAll
do
    local sub = string.sub
    local find = string.find
    function __TS__StringReplaceAll(source, searchValue, replaceValue)
        if type(replaceValue) == "string" then
            local concat = table.concat(
                __TS__StringSplit(source, searchValue),
                replaceValue
            )
            if #searchValue == 0 then
                return (replaceValue .. concat) .. replaceValue
            end
            return concat
        end
        local parts = {}
        local partsIndex = 1
        if #searchValue == 0 then
            parts[1] = replaceValue(nil, "", 0, source)
            partsIndex = 2
            for i = 1, #source do
                parts[partsIndex] = sub(source, i, i)
                parts[partsIndex + 1] = replaceValue(nil, "", i, source)
                partsIndex = partsIndex + 2
            end
        else
            local currentPos = 1
            while true do
                local startPos, endPos = find(source, searchValue, currentPos, true)
                if not startPos then
                    break
                end
                parts[partsIndex] = sub(source, currentPos, startPos - 1)
                parts[partsIndex + 1] = replaceValue(nil, searchValue, startPos - 1, source)
                partsIndex = partsIndex + 2
                currentPos = endPos + 1
            end
            parts[partsIndex] = sub(source, currentPos)
        end
        return table.concat(parts)
    end
end

local function __TS__StringSlice(self, start, ____end)
    if start == nil or start ~= start then
        start = 0
    end
    if ____end ~= ____end then
        ____end = 0
    end
    if start >= 0 then
        start = start + 1
    end
    if ____end ~= nil and ____end < 0 then
        ____end = ____end - 1
    end
    return string.sub(self, start, ____end)
end

local function __TS__StringStartsWith(self, searchString, position)
    if position == nil or position < 0 then
        position = 0
    end
    return string.sub(self, position + 1, #searchString + position) == searchString
end

local function __TS__StringSubstr(self, from, length)
    if from ~= from then
        from = 0
    end
    if length ~= nil then
        if length ~= length or length <= 0 then
            return ""
        end
        length = length + from
    end
    if from >= 0 then
        from = from + 1
    end
    return string.sub(self, from, length)
end

local function __TS__StringTrim(self)
    local result = string.gsub(self, "^[%s ﻿]*(.-)[%s ﻿]*$", "%1")
    return result
end

local function __TS__StringTrimEnd(self)
    local result = string.gsub(self, "[%s ﻿]*$", "")
    return result
end

local function __TS__StringTrimStart(self)
    local result = string.gsub(self, "^[%s ﻿]*", "")
    return result
end

local __TS__SymbolRegistryFor, __TS__SymbolRegistryKeyFor
do
    local symbolRegistry = {}
    function __TS__SymbolRegistryFor(key)
        if not symbolRegistry[key] then
            symbolRegistry[key] = __TS__Symbol(key)
        end
        return symbolRegistry[key]
    end
    function __TS__SymbolRegistryKeyFor(sym)
        for key in pairs(symbolRegistry) do
            if symbolRegistry[key] == sym then
                return key
            end
        end
        return nil
    end
end

local function __TS__TypeOf(value)
    local luaType = type(value)
    if luaType == "table" then
        return "object"
    elseif luaType == "nil" then
        return "undefined"
    else
        return luaType
    end
end

local function __TS__Using(self, cb, ...)
    local args = {...}
    local thrownError
    local ok, result = xpcall(
        function() return cb(__TS__Unpack(args)) end,
        function(err)
            thrownError = err
            return thrownError
        end
    )
    local argArray = {__TS__Unpack(args)}
    do
        local i = #argArray - 1
        while i >= 0 do
            local ____self_0 = argArray[i + 1]
            ____self_0[Symbol.dispose](____self_0)
            i = i - 1
        end
    end
    if not ok then
        error(thrownError, 0)
    end
    return result
end

local function __TS__UsingAsync(self, cb, ...)
    local args = {...}
    return __TS__AsyncAwaiter(function(____awaiter_resolve)
        local thrownError
        local ok, result = xpcall(
            function() return cb(
                nil,
                __TS__Unpack(args)
            ) end,
            function(err)
                thrownError = err
                return thrownError
            end
        )
        local argArray = {__TS__Unpack(args)}
        do
            local i = #argArray - 1
            while i >= 0 do
                if argArray[i + 1][Symbol.dispose] ~= nil then
                    local ____self_0 = argArray[i + 1]
                    ____self_0[Symbol.dispose](____self_0)
                end
                if argArray[i + 1][Symbol.asyncDispose] ~= nil then
                    local ____self_1 = argArray[i + 1]
                    __TS__Await(____self_1[Symbol.asyncDispose](____self_1))
                end
                i = i - 1
            end
        end
        if not ok then
            error(thrownError, 0)
        end
        return ____awaiter_resolve(nil, result)
    end)
end

return {
  __TS__ArrayAt = __TS__ArrayAt,
  __TS__ArrayConcat = __TS__ArrayConcat,
  __TS__ArrayEntries = __TS__ArrayEntries,
  __TS__ArrayEvery = __TS__ArrayEvery,
  __TS__ArrayFill = __TS__ArrayFill,
  __TS__ArrayFilter = __TS__ArrayFilter,
  __TS__ArrayForEach = __TS__ArrayForEach,
  __TS__ArrayFind = __TS__ArrayFind,
  __TS__ArrayFindIndex = __TS__ArrayFindIndex,
  __TS__ArrayFrom = __TS__ArrayFrom,
  __TS__ArrayIncludes = __TS__ArrayIncludes,
  __TS__ArrayIndexOf = __TS__ArrayIndexOf,
  __TS__ArrayIsArray = __TS__ArrayIsArray,
  __TS__ArrayJoin = __TS__ArrayJoin,
  __TS__ArrayMap = __TS__ArrayMap,
  __TS__ArrayPush = __TS__ArrayPush,
  __TS__ArrayPushArray = __TS__ArrayPushArray,
  __TS__ArrayReduce = __TS__ArrayReduce,
  __TS__ArrayReduceRight = __TS__ArrayReduceRight,
  __TS__ArrayReverse = __TS__ArrayReverse,
  __TS__ArrayUnshift = __TS__ArrayUnshift,
  __TS__ArraySort = __TS__ArraySort,
  __TS__ArraySlice = __TS__ArraySlice,
  __TS__ArraySome = __TS__ArraySome,
  __TS__ArraySplice = __TS__ArraySplice,
  __TS__ArrayToObject = __TS__ArrayToObject,
  __TS__ArrayFlat = __TS__ArrayFlat,
  __TS__ArrayFlatMap = __TS__ArrayFlatMap,
  __TS__ArraySetLength = __TS__ArraySetLength,
  __TS__ArrayToReversed = __TS__ArrayToReversed,
  __TS__ArrayToSorted = __TS__ArrayToSorted,
  __TS__ArrayToSpliced = __TS__ArrayToSpliced,
  __TS__ArrayWith = __TS__ArrayWith,
  __TS__AsyncAwaiter = __TS__AsyncAwaiter,
  __TS__Await = __TS__Await,
  __TS__Class = __TS__Class,
  __TS__ClassExtends = __TS__ClassExtends,
  __TS__CloneDescriptor = __TS__CloneDescriptor,
  __TS__CountVarargs = __TS__CountVarargs,
  __TS__Decorate = __TS__Decorate,
  __TS__DecorateLegacy = __TS__DecorateLegacy,
  __TS__DecorateParam = __TS__DecorateParam,
  __TS__Delete = __TS__Delete,
  __TS__DelegatedYield = __TS__DelegatedYield,
  __TS__DescriptorGet = __TS__DescriptorGet,
  __TS__DescriptorSet = __TS__DescriptorSet,
  Error = Error,
  RangeError = RangeError,
  ReferenceError = ReferenceError,
  SyntaxError = SyntaxError,
  TypeError = TypeError,
  URIError = URIError,
  __TS__FunctionBind = __TS__FunctionBind,
  __TS__Generator = __TS__Generator,
  __TS__InstanceOf = __TS__InstanceOf,
  __TS__InstanceOfObject = __TS__InstanceOfObject,
  __TS__Iterator = __TS__Iterator,
  __TS__LuaIteratorSpread = __TS__LuaIteratorSpread,
  Map = Map,
  __TS__MapGroupBy = __TS__MapGroupBy,
  __TS__Match = __TS__Match,
  __TS__MathAtan2 = __TS__MathAtan2,
  __TS__MathModf = __TS__MathModf,
  __TS__MathSign = __TS__MathSign,
  __TS__MathTrunc = __TS__MathTrunc,
  __TS__New = __TS__New,
  __TS__Number = __TS__Number,
  __TS__NumberIsFinite = __TS__NumberIsFinite,
  __TS__NumberIsInteger = __TS__NumberIsInteger,
  __TS__NumberIsNaN = __TS__NumberIsNaN,
  __TS__ParseInt = __TS__ParseInt,
  __TS__ParseFloat = __TS__ParseFloat,
  __TS__NumberToString = __TS__NumberToString,
  __TS__NumberToFixed = __TS__NumberToFixed,
  __TS__ObjectAssign = __TS__ObjectAssign,
  __TS__ObjectDefineProperty = __TS__ObjectDefineProperty,
  __TS__ObjectEntries = __TS__ObjectEntries,
  __TS__ObjectFromEntries = __TS__ObjectFromEntries,
  __TS__ObjectGetOwnPropertyDescriptor = __TS__ObjectGetOwnPropertyDescriptor,
  __TS__ObjectGetOwnPropertyDescriptors = __TS__ObjectGetOwnPropertyDescriptors,
  __TS__ObjectGroupBy = __TS__ObjectGroupBy,
  __TS__ObjectKeys = __TS__ObjectKeys,
  __TS__ObjectRest = __TS__ObjectRest,
  __TS__ObjectValues = __TS__ObjectValues,
  __TS__ParseFloat = __TS__ParseFloat,
  __TS__ParseInt = __TS__ParseInt,
  __TS__Promise = __TS__Promise,
  __TS__PromiseAll = __TS__PromiseAll,
  __TS__PromiseAllSettled = __TS__PromiseAllSettled,
  __TS__PromiseAny = __TS__PromiseAny,
  __TS__PromiseRace = __TS__PromiseRace,
  Set = Set,
  __TS__SetDescriptor = __TS__SetDescriptor,
  __TS__SparseArrayNew = __TS__SparseArrayNew,
  __TS__SparseArrayPush = __TS__SparseArrayPush,
  __TS__SparseArraySpread = __TS__SparseArraySpread,
  WeakMap = WeakMap,
  WeakSet = WeakSet,
  __TS__SourceMapTraceBack = __TS__SourceMapTraceBack,
  __TS__Spread = __TS__Spread,
  __TS__StringAccess = __TS__StringAccess,
  __TS__StringCharAt = __TS__StringCharAt,
  __TS__StringCharCodeAt = __TS__StringCharCodeAt,
  __TS__StringEndsWith = __TS__StringEndsWith,
  __TS__StringIncludes = __TS__StringIncludes,
  __TS__StringPadEnd = __TS__StringPadEnd,
  __TS__StringPadStart = __TS__StringPadStart,
  __TS__StringReplace = __TS__StringReplace,
  __TS__StringReplaceAll = __TS__StringReplaceAll,
  __TS__StringSlice = __TS__StringSlice,
  __TS__StringSplit = __TS__StringSplit,
  __TS__StringStartsWith = __TS__StringStartsWith,
  __TS__StringSubstr = __TS__StringSubstr,
  __TS__StringSubstring = __TS__StringSubstring,
  __TS__StringTrim = __TS__StringTrim,
  __TS__StringTrimEnd = __TS__StringTrimEnd,
  __TS__StringTrimStart = __TS__StringTrimStart,
  __TS__Symbol = __TS__Symbol,
  Symbol = Symbol,
  __TS__SymbolRegistryFor = __TS__SymbolRegistryFor,
  __TS__SymbolRegistryKeyFor = __TS__SymbolRegistryKeyFor,
  __TS__TypeOf = __TS__TypeOf,
  __TS__Unpack = __TS__Unpack,
  __TS__Using = __TS__Using,
  __TS__UsingAsync = __TS__UsingAsync
}
 end,
["src.lua.client-info"] = function(...) 
local ____lualib = require("lualib_bundle")
local __TS__SourceMapTraceBack = ____lualib.__TS__SourceMapTraceBack
local ____exports = {}
function ____exports.getClientInfoFactory(self, name, options)
    return function()
        local info = {
            name = name,
            category = "0x1F956",
            author = "0x1F320",
            versionNumber = options and options.versionNumber or 1,
            minEditorVersion = options and options.minEditorVersion or 0
        }
        if (options and options.type) ~= nil then
            info.type = options.type
        end
        return info
    end
end
return ____exports
 end,
["src.lua.json"] = function(...) 
local ____lualib = require("lualib_bundle")
local __TS__NumberIsNaN = ____lualib.__TS__NumberIsNaN
local __TS__SourceMapTraceBack = ____lualib.__TS__SourceMapTraceBack
local ____exports = {}
local ESCAPES = {
    ["\""] = "\\\"",
    ["\\"] = "\\\\",
    ["\n"] = "\\n",
    ["\r"] = "\\r",
    ["\t"] = "\\t",
    ["\b"] = "\\b",
    ["\f"] = "\\f"
}
local function encodeString(self, text)
    local escaped = string.gsub(
        text,
        "[%c\"\\]",
        function(char)
            local known = ESCAPES[char]
            return known ~= nil and known or string.format(
                "\\u%04x",
                string.byte(char)
            )
        end
    )
    return ("\"" .. escaped) .. "\""
end
local function encodeNumber(self, value)
    if math.type(value) == "integer" then
        return string.format("%d", value)
    end
    if __TS__NumberIsNaN(value) or value == math.huge or value == -math.huge then
        return "null"
    end
    return string.format("%.14g", value)
end
--- An empty Lua table is indistinguishable from an empty array, and `[]` is the
-- shape the payload actually has an empty case for (a group with no notes), so
-- that is the way the ambiguity is resolved.
function ____exports.encodeJson(self, value)
    if value == nil or value == nil then
        return "null"
    end
    local kind = type(value)
    if kind == "number" then
        return encodeNumber(nil, value)
    end
    if kind == "boolean" then
        return value == true and "true" or "false"
    end
    if kind == "string" then
        return encodeString(nil, value)
    end
    local ____table = value
    local parts = {}
    local count = #value
    if count > 0 or ({next(____table)}) == nil then
        local items = value
        do
            local i = 0
            while i < count do
                parts[i + 1] = ____exports.encodeJson(nil, items[i + 1])
                i = i + 1
            end
        end
        return ("[" .. table.concat(parts, ",")) .. "]"
    end
    for key in pairs(____table) do
        parts[#parts + 1] = (encodeString(nil, key) .. ":") .. ____exports.encodeJson(nil, ____table[key])
    end
    return ("{" .. table.concat(parts, ",")) .. "}"
end
return ____exports
 end,
["src.lua.sv-index"] = function(...) 
local ____lualib = require("lualib_bundle")
local __TS__SourceMapTraceBack = ____lualib.__TS__SourceMapTraceBack
local ____exports = {}
--- SynthV's Lua API counts from 1 and errors out on 0, while TypeScript counts
-- from 0. Every index handed to the API goes through here, so the conversion is
-- one visible call rather than a `+ 1` that reads like a typo — and `SVIndex`
-- being unforgeable means a raw loop counter cannot reach an API method by
-- accident.
function ____exports.svIndex(self, zeroBased)
    return zeroBased + 1
end
--- The inverse, for indices the API hands back (`getIndexInParent`).
function ____exports.fromSVIndex(self, index)
    return index - 1
end
return ____exports
 end,
["src.lua.bridge.codec"] = function(...) 
local ____lualib = require("lualib_bundle")
local __TS__SparseArrayNew = ____lualib.__TS__SparseArrayNew
local __TS__SparseArrayPush = ____lualib.__TS__SparseArrayPush
local __TS__SparseArraySpread = ____lualib.__TS__SparseArraySpread
local __TS__SourceMapTraceBack = ____lualib.__TS__SourceMapTraceBack
local ____exports = {}
--- The wire format. Binary, because the cost that matters is the encoder, and it
-- runs on SynthV's UI thread: a 2000-note schedule with pitch curves takes
-- 18.8 ms to build as JSON and 2.0 ms with `string.pack` — the difference
-- between the editor dropping a frame on every edit and not. The record also
-- halves, 420 KB to 195 KB, and the reader stops allocating an object per
-- frame for the hot channel.
-- 
-- What binary costs is forgiveness. JSON tolerates a field appearing or
-- changing type; a fixed layout silently misreads it. So every record carries
-- `MAGIC` and a layout version, and a reader that does not recognise both must
-- refuse the record rather than interpret it.
-- 
-- Blicks travel as float64, not int64. They are exact well past any project
-- length (2^53 blicks is millions of minutes) and it keeps the reader off
-- `getBigInt64`, which allocates a BigInt per field.
local MAGIC = "VPB1"
--- 3: bends carry BEND_PAD samples on each side of their note.
____exports.LAYOUT = 3
____exports.CHANNEL_STATE = 1
____exports.CHANNEL_NOTES = 2
local HEADER = "<c4I2I2I4"
____exports.STATUS_CODES = {stopped = 0, playing = 1, looping = 2}
local function record(self, channel, payload)
    return string.pack(
        HEADER,
        MAGIC,
        ____exports.LAYOUT,
        channel,
        string.len(payload)
    ) .. payload
end
local HAS_LOOP = 1
function ____exports.encodeState(self, state)
    local loop = state.loop
    local doubles = {
        state.at,
        loop ~= nil and loop.start or 0,
        loop ~= nil and loop["end"] or 0,
        state.perBlick,
        state.perSemitone,
        state.viewLeft,
        state.viewRight,
        state.viewTop,
        state.viewBottom
    }
    local ____record_2 = record
    local ____string_pack_1 = string.pack
    local ____array_0 = __TS__SparseArrayNew(
        ("<I4I4BB" .. string.rep("d", #doubles)) .. "s2",
        state.seq,
        state.notesSeq,
        ____exports.STATUS_CODES[state.status] or 0,
        loop ~= nil and HAS_LOOP or 0,
        table.unpack(doubles)
    )
    __TS__SparseArrayPush(____array_0, state.rev)
    return ____record_2(
        nil,
        ____exports.CHANNEL_STATE,
        ____string_pack_1(__TS__SparseArraySpread(____array_0))
    )
end
--- One `string.pack` per bend array rather than one per sample: packing sample
-- by sample and concatenating costs 7.4 ms where this costs 2.0 ms, for the
-- same bytes.
local BEND_FORMATS = {}
local function bendFormat(self, count)
    local cached = BEND_FORMATS[count]
    if cached ~= nil then
        return cached
    end
    local format = "<" .. string.rep("i2", count)
    BEND_FORMATS[count] = format
    return format
end
function ____exports.encodeNotes(self, rev, notes)
    local parts = {}
    do
        local i = 0
        while i < #notes do
            local note = notes[i + 1]
            local bend = note.bend or ({})
            local packed = string.pack(
                "<ddddi2s2I2",
                note.onB,
                note.offB,
                note.onS,
                note.offS,
                note.pitch,
                note.lyric,
                #bend
            )
            if #bend > 0 then
                packed = packed .. string.pack(
                    bendFormat(nil, #bend),
                    table.unpack(bend)
                )
            end
            parts[i + 1] = packed
            i = i + 1
        end
    end
    return record(
        nil,
        ____exports.CHANNEL_NOTES,
        string.pack("<s2I4", rev, #notes) .. table.concat(parts)
    )
end
return ____exports
 end,
["src.lua.bridge.model"] = function(...) 
local ____lualib = require("lualib_bundle")
local __TS__SourceMapTraceBack = ____lualib.__TS__SourceMapTraceBack
local ____exports = {}
local ____sv_2Dindex = require("src.lua.sv-index")
local svIndex = ____sv_2Dindex.svIndex
function ____exports.currentGroup(self)
    return SV:getMainEditor():getCurrentGroup()
end
--- Enough of the view transform for the app to turn blicks into pixels. It
-- rescales this itself from the piano roll's own geometry as the user zooms, so
-- this only has to be right at send time.
function ____exports.viewMapping(self)
    local nav = SV:getMainEditor():getNavigation()
    local time = nav:getTimeViewRange()
    local value = nav:getValueViewRange()
    return {
        perBlick = nav:getTimePxPerUnit(),
        perSemitone = nav:getValuePxPerUnit(),
        viewLeft = time[1],
        viewRight = time[2],
        viewTop = value[2],
        viewBottom = value[1]
    }
end
--- Sampling step for the pitch curve. A 32nd of a quarter is ~16ms at 120bpm,
-- which oversamples a 6Hz vibrato several times over — fine enough that the app
-- can interpolate between samples without the wobble going square.
local BEND_INTERVAL = math.floor(SV.QUARTER / 32)
--- Below this the frame is silence, not a pitch.
-- 
-- The docs say samples with no data come back as null. Measured, they do not: a
-- computed group returns a full array in which unvoiced frames read 0. Taken at
-- face value that is a pitch of MIDI 0, which becomes an offset of about -69
-- semitones and throws the app's effect clean off the screen.
local VOICED_FLOOR = 1
--- `bend` travels as int16, and `string.pack` raises on anything that overflows.
local BEND_LIMIT = 32767
--- Padding sample the engine had no voice for. The app draws nothing there.
-- 
-- Unvoiced samples inside a note hold the previous offset, so a consonant does
-- not jerk the effect back — but padding before the voice starts has no previous
-- offset to hold, and held zero reads as "on the note's own pitch". That put the
-- effect in empty space ahead of a note, at exactly the height of a curve that
-- had not begun. int16's floor is outside any pitch this carries, so it can say
-- "nothing here" without spending a field on it.
local NO_CURVE = -32768
--- Samples carried on each side of the note, beyond its own span.
-- 
-- The curve does not start at the onset and stop at the end: the engine glides
-- into a note before it begins and lets it go after it finishes, and those are
-- the steepest parts of the whole line. Sampling the note alone cut them off,
-- which left the app unable to show where the voice actually went.
-- 
-- The app mirrors this constant to know where the note sits inside the array —
-- see `renderer/src/playback/pitch.ts`. Every bend therefore carries exactly
-- this many samples on each side, edge-held rather than clipped when the group
-- runs out, so the count never has to be guessed from the length.
local BEND_PAD = 8
--- The computed pitch across the whole group, or undefined if the engine has
-- none.
-- 
-- Sampled in one call rather than one per note: the curve is a single buffer and
-- asking for it a note at a time would cost hundreds of calls for the same data.
-- An empty result means pitch computation has not finished for this group, which
-- is a state real projects sit in — the app falls back rather than showing
-- nothing.
-- 
-- The window reaches BEND_PAD beyond the group at both ends. Without that the
-- outermost notes have nothing real to pad with and hold their edge sample
-- instead, which is precisely where the curve does its most visible thing —
-- the release after the last note can fly several semitones clear of it.
local function computedPitch(self, ref, startB, endB)
    local frames = math.ceil((endB - startB) / BEND_INTERVAL) + 1 + 2 * BEND_PAD
    if frames <= 0 then
        return nil
    end
    local curve = SV:getComputedPitchForGroup(ref, startB - BEND_PAD * BEND_INTERVAL, BEND_INTERVAL, frames)
    if curve[1] == nil then
        return nil
    end
    return {curve = curve, frames = frames}
end
--- One note's slice of the group curve, in cents from its own pitch. Undefined
-- when the note has no voiced frame at all, so the app synthesizes that note
-- instead of drawing a flat line through a rest.
local function bendForNote(self, curve, frames, startB, note)
    local onset = math.floor((note.onB - startB) / BEND_INTERVAL + 0.5) + BEND_PAD
    local from = onset - BEND_PAD
    local to = math.floor((note.offB - startB) / BEND_INTERVAL + 0.5) + BEND_PAD + BEND_PAD
    if to < from then
        return nil
    end
    local bend = {}
    local last = 0
    local voiced = false
    local firstVoiced = -1
    local lastVoiced = -1
    do
        local i = from
        while i <= to do
            local sample = curve[math.max(
                0,
                math.min(frames - 1, i)
            ) + 1]
            if sample ~= nil and sample >= VOICED_FLOOR then
                local cents = math.floor((sample - note.pitch) * 100 + 0.5)
                last = math.max(
                    -BEND_LIMIT,
                    math.min(BEND_LIMIT, cents)
                )
                voiced = true
                if firstVoiced < 0 then
                    firstVoiced = #bend
                end
                lastVoiced = #bend
            end
            bend[#bend + 1] = last
            i = i + 1
        end
    end
    if not voiced then
        return nil
    end
    do
        local i = 0
        while i < BEND_PAD do
            if i < firstVoiced then
                bend[i + 1] = NO_CURVE
            end
            local tail = #bend - 1 - i
            if tail > lastVoiced then
                bend[tail + 1] = NO_CURVE
            end
            i = i + 1
        end
    end
    return bend
end
function ____exports.collectNotes(self)
    local ref = ____exports.currentGroup(nil)
    if ref == nil then
        return {}
    end
    local timeAxis = SV:getProject():getTimeAxis()
    local offset = ref:getTimeOffset()
    local group = ref:getTarget()
    local count = group:getNumNotes()
    local notes = {}
    do
        local i = 0
        while i < count do
            local note = group:getNote(svIndex(nil, i))
            local onB = note:getOnset() + offset
            local offB = note:getEnd() + offset
            notes[i + 1] = {
                onB = onB,
                offB = offB,
                onS = timeAxis:getSecondsFromBlick(onB),
                offS = timeAxis:getSecondsFromBlick(offB),
                pitch = note:getPitch(),
                lyric = note:getLyrics()
            }
            i = i + 1
        end
    end
    if #notes > 0 then
        local startB = notes[1].onB
        local computed = computedPitch(nil, ref, startB, notes[#notes].offB)
        if computed ~= nil then
            for ____, note in ipairs(notes) do
                note.bend = bendForNote(
                    nil,
                    computed.curve,
                    computed.frames,
                    startB,
                    note
                )
            end
        end
    end
    return notes
end
local FNV_PRIME = 16777619
local FNV_OFFSET = 2166136261
local MASK32 = 4294967295
--- Rewritten rather than ported. The JavaScript version leans on doubles —
-- `hash * 31 % 1e12` with a float modulus — and Lua 5.4 integers wrap at 2^63
-- instead of losing precision, so the same expressions produce a different
-- number for the same project. This keeps every intermediate inside 32 bits,
-- where wrapping is the definition rather than an accident.
local function mix(self, hash, value)
    return (hash ~ value & MASK32) * FNV_PRIME & MASK32
end
local function mixBlick(self, hash, blick)
    return mix(
        nil,
        mix(nil, hash, blick & MASK32),
        blick >> 32
    )
end
local function mixString(self, hash, text)
    local mixed = mix(
        nil,
        hash,
        string.len(text)
    )
    do
        local i = 1
        while i <= string.len(text) do
            mixed = mix(
                nil,
                mixed,
                string.byte(text, i) or 0
            )
            i = i + 1
        end
    end
    return mixed
end
--- Cheap fingerprint of the current group's notes — an edit detector.
function ____exports.currentRevision(self)
    local ref = ____exports.currentGroup(nil)
    if ref == nil then
        return "0"
    end
    local group = ref:getTarget()
    local count = group:getNumNotes()
    local hash = mix(nil, FNV_OFFSET, count)
    do
        local i = 0
        while i < count do
            local note = group:getNote(svIndex(nil, i))
            hash = mixBlick(
                nil,
                hash,
                note:getOnset()
            )
            hash = mixBlick(
                nil,
                hash,
                note:getEnd()
            )
            hash = mix(
                nil,
                hash,
                note:getPitch()
            )
            hash = mixString(
                nil,
                hash,
                note:getLyrics()
            )
            i = i + 1
        end
    end
    return (((tostring(ref:getTimeOffset()) .. ":") .. tostring(count)) .. ":") .. tostring(hash)
end
return ____exports
 end,
["src.lua.bridge.paths"] = function(...) 
local ____lualib = require("lualib_bundle")
local __TS__SourceMapTraceBack = ____lualib.__TS__SourceMapTraceBack
local ____exports = {}
--- Where the channels live. Both sides have to reach the same directory with no
-- configuration, so it is the app's own data directory — and **the app creates
-- it**, not the script: Lua has no mkdir, and the alternative is `os.execute`,
-- which spawns a shell from inside a DAW for the privilege of making one
-- folder. A failed open here simply means the app is not installed or has never
-- run, which the panel reports and the next tick retries.
local DIRECTORY_NAME = "voxpane"
local CHANNEL_DIRECTORY = "bridge"
local WINDOWS = string.find(
    string.lower(SV:getHostInfo().osType),
    "win",
    1,
    true
)
local IS_WINDOWS = WINDOWS ~= nil
function ____exports.bridgeDirectory(self)
    if IS_WINDOWS then
        local ____local = os.getenv("LOCALAPPDATA")
        return ____local ~= nil and (((____local .. "\\") .. DIRECTORY_NAME) .. "\\") .. CHANNEL_DIRECTORY or nil
    end
    local home = os.getenv("HOME")
    return home ~= nil and (((home .. "/Library/Application Support/") .. DIRECTORY_NAME) .. "/") .. CHANNEL_DIRECTORY or nil
end
function ____exports.channelPath(self, directory, name)
    return IS_WINDOWS and (directory .. "\\") .. name or (directory .. "/") .. name
end
return ____exports
 end,
["src.lua.bridge.channels"] = function(...) 
local ____lualib = require("lualib_bundle")
local __TS__SourceMapTraceBack = ____lualib.__TS__SourceMapTraceBack
local ____exports = {}
local ____paths = require("src.lua.bridge.paths")
local channelPath = ____paths.channelPath
local function open(self, path)
    local existing = io.open(path, "r+b")
    if existing ~= nil then
        existing:setvbuf("no")
        return existing
    end
    local created = io.open(path, "w+b")
    if created ~= nil then
        created:setvbuf("no")
    end
    return created
end
--- A channel whose value is only ever the latest one: the playhead, the view
-- transform. Padded to a fixed width so the record never changes size and the
-- reader can ask for exactly that many bytes.
function ____exports.hotChannel(self, directory, name, width)
    local path = channelPath(nil, directory, name)
    local handle = open(nil, path)
    return {
        publish = function(self, record)
            if string.len(record) > width then
                return false
            end
            if handle == nil then
                handle = open(nil, path)
                if handle == nil then
                    return false
                end
            end
            handle:seek("set", 0)
            local written = handle:write(record .. string.rep(
                " ",
                width - string.len(record)
            ))
            if written == nil then
                handle:close()
                handle = nil
                return false
            end
            return true
        end,
        close = function(self)
            if handle ~= nil then
                handle:close()
                handle = nil
            end
        end
    }
end
--- A channel that changes rarely and by a lot: the note schedule, the pitch
-- curves. Written whole, in one call, at offset 0 — the file only ever grows to
-- the largest record it has carried, and the length prefix makes the leftover
-- tail meaningless.
function ____exports.coldChannel(self, directory, name)
    local path = channelPath(nil, directory, name)
    local handle = open(nil, path)
    return {
        publish = function(self, record)
            if handle == nil then
                handle = open(nil, path)
                if handle == nil then
                    return false
                end
            end
            handle:seek("set", 0)
            local written = handle:write(record)
            if written == nil then
                handle:close()
                handle = nil
                return false
            end
            return true
        end,
        close = function(self)
            if handle ~= nil then
                handle:close()
                handle = nil
            end
        end
    }
end
return ____exports
 end,
["src.lua.bridge.publisher"] = function(...) 
local ____lualib = require("lualib_bundle")
local __TS__SourceMapTraceBack = ____lualib.__TS__SourceMapTraceBack
local ____exports = {}
local closeAll, unavailable
local ____json = require("src.lua.json")
local encodeJson = ____json.encodeJson
local ____channels = require("src.lua.bridge.channels")
local coldChannel = ____channels.coldChannel
local hotChannel = ____channels.hotChannel
local ____codec = require("src.lua.bridge.codec")
local encodeNotes = ____codec.encodeNotes
local encodeState = ____codec.encodeState
local LAYOUT = ____codec.LAYOUT
local ____paths = require("src.lua.bridge.paths")
local bridgeDirectory = ____paths.bridgeDirectory
function closeAll(self, channels)
    for ____, channel in ipairs(channels) do
        channel:close()
    end
end
function unavailable(self, reason)
    return {
        ready = false,
        publishState = function()
        end,
        publishNotes = function()
        end,
        describe = function() return "unavailable: " .. reason end,
        close = function()
        end
    }
end
local PROTOCOL = 1
--- The hot record is padded to this, so it must fit the longest `rev` a project
-- can produce. Publishing fails rather than truncating if it ever does not.
local STATE_WIDTH = 256
local SESSION_WIDTH = 1024
function ____exports.createPublisher(self)
    local directory = bridgeDirectory(nil)
    if directory == nil then
        return unavailable(nil, "no home directory")
    end
    local session = hotChannel(nil, directory, "session.json", SESSION_WIDTH)
    local state = hotChannel(nil, directory, "state", STATE_WIDTH)
    local notes = coldChannel(nil, directory, "notes")
    local host = SV:getHostInfo()
    local announced = session:publish(encodeJson(
        nil,
        {
            v = PROTOCOL,
            layout = LAYOUT,
            session = tostring(os.time()),
            host = {osType = host.osType, hostName = host.hostName, hostVersion = host.hostVersion, hostVersionNumber = host.hostVersionNumber},
            channels = {{name = "state", kind = "hot", encoding = "binary", width = STATE_WIDTH}, {name = "notes", kind = "cold", encoding = "binary"}}
        }
    ))
    if not announced then
        closeAll(nil, {session, state, notes})
        return unavailable(nil, "cannot write to " .. directory)
    end
    local seq = 0
    local notesSeq = 0
    local lastError = "none"
    return {
        ready = true,
        publishState = function(self, value)
            seq = seq + 1
            local ok = state:publish(encodeState(nil, {
                seq = seq,
                notesSeq = notesSeq,
                at = value.at,
                status = value.status,
                loop = value.loop,
                perBlick = value.perBlick,
                perSemitone = value.perSemitone,
                viewLeft = value.viewLeft,
                viewRight = value.viewRight,
                viewTop = value.viewTop,
                viewBottom = value.viewBottom,
                rev = value.rev
            }))
            if not ok then
                lastError = "state write failed"
            end
        end,
        publishNotes = function(self, rev, value)
            notesSeq = notesSeq + 1
            if not notes:publish(encodeNotes(nil, rev, value)) then
                lastError = "notes write failed"
            end
        end,
        describe = function(self)
            return ((((((directory .. " (seq ") .. tostring(seq)) .. ", notes ") .. tostring(notesSeq)) .. ", last error: ") .. lastError) .. ")"
        end,
        close = function(self)
            closeAll(nil, {session, state, notes})
        end
    }
end
return ____exports
 end,
["src.lua.ui.button"] = function(...) 
local ____lualib = require("lualib_bundle")
local __TS__SourceMapTraceBack = ____lualib.__TS__SourceMapTraceBack
local ____exports = {}
function ____exports.button(self, text, value, width)
    return {type = "Button", text = text, value = value, width = width}
end
return ____exports
 end,
["src.lua.ui.label"] = function(...) 
local ____lualib = require("lualib_bundle")
local __TS__SourceMapTraceBack = ____lualib.__TS__SourceMapTraceBack
local ____exports = {}
function ____exports.label(self, text)
    return {type = "Label", text = text}
end
return ____exports
 end,
["src.lua.ui.row"] = function(...) 
local ____lualib = require("lualib_bundle")
local __TS__SourceMapTraceBack = ____lualib.__TS__SourceMapTraceBack
local ____exports = {}
function ____exports.row(self, columns)
    return {type = "Container", columns = columns}
end
return ____exports
 end,
["src.lua.version"] = function(...) 
local ____lualib = require("lualib_bundle")
local __TS__SourceMapTraceBack = ____lualib.__TS__SourceMapTraceBack
local ____exports = {}
____exports.SCRIPT_VERSION = "dev f29d99a-dirty"
return ____exports
 end,
["src.lua.overlay-bridge"] = function(...) 
local ____lualib = require("lualib_bundle")
local __TS__Class = ____lualib.__TS__Class
local __TS__New = ____lualib.__TS__New
local __TS__SourceMapTraceBack = ____lualib.__TS__SourceMapTraceBack
local ____exports = {}
local ____model = require("src.lua.bridge.model")
local collectNotes = ____model.collectNotes
local currentRevision = ____model.currentRevision
local viewMapping = ____model.viewMapping
local ____publisher = require("src.lua.bridge.publisher")
local createPublisher = ____publisher.createPublisher
local ____client_2Dinfo = require("src.lua.client-info")
local getClientInfoFactory = ____client_2Dinfo.getClientInfoFactory
local ____button = require("src.lua.ui.button")
local button = ____button.button
local ____label = require("src.lua.ui.label")
local label = ____label.label
local ____row = require("src.lua.ui.row")
local row = ____row.row
local ____version = require("src.lua.version")
local SCRIPT_VERSION = ____version.SCRIPT_VERSION
local SCRIPT_TITLE = "Overlay Bridge"
local CONFIG = {tickInterval = 16, revisionInterval = 500}
local OverlayBridge = __TS__Class()
OverlayBridge.name = "OverlayBridge"
function OverlayBridge.prototype.____constructor(self)
    self.enabled = true
    self.ticks = 0
    self.lastStatus = "stopped"
    self.lastPlayhead = 0
    self.lastRevisionCheck = 0
    self.revision = ""
    self.loopStart = nil
    self.loopEnd = nil
    self.notesPublished = 0
    self.lastError = "none"
    self.publisher = createPublisher(nil)
    self.toggleButton = SV:create("WidgetValue")
    self.resendButton = SV:create("WidgetValue")
    self.toggleButton:setValueChangeCallback(function() return self:toggle() end)
    self.resendButton:setValueChangeCallback(function() return self:publishNotes() end)
    self:loop()
end
function OverlayBridge.prototype.getState(self)
    local loop = (self.loopStart == nil or self.loopEnd == nil) and "not seen yet" or ((string.format("%.2f", self.loopStart) .. "s - ") .. string.format("%.2f", self.loopEnd)) .. "s"
    return {
        title = SCRIPT_TITLE,
        rows = {
            label(nil, "Version: " .. SCRIPT_VERSION),
            label(nil, "Bridge: " .. (self.enabled and "on" or "off")),
            label(
                nil,
                "Channels: " .. self.publisher:describe()
            ),
            label(nil, "Transport: " .. self.lastStatus),
            label(
                nil,
                "Notes published: " .. tostring(self.notesPublished)
            ),
            label(nil, "Loop: " .. loop),
            label(nil, "Last error: " .. self.lastError),
            row(
                nil,
                {button(nil, self.enabled and "Disable" or "Enable", self.toggleButton, 1)}
            ),
            row(
                nil,
                {button(nil, "Resend schedule", self.resendButton, 1)}
            )
        }
    }
end
function OverlayBridge.prototype.toggle(self)
    self.enabled = not self.enabled
    self:refresh()
end
function OverlayBridge.prototype.loop(self)
    do
        local function ____catch(____error)
            self.lastError = tostring(____error)
        end
        local ____try, ____hasReturned = pcall(function()
            if self.enabled then
                self:tick()
            end
            self.lastError = "none"
        end)
        if not ____try then
            ____catch(____hasReturned)
        end
        do
            SV:setTimeout(
                CONFIG.tickInterval,
                function() return self:loop() end
            )
        end
    end
end
function OverlayBridge.prototype.refresh(self)
    do
        pcall(function()
            SV:refreshSidePanel()
        end)
    end
end
function OverlayBridge.prototype.tick(self)
    self.ticks = self.ticks + 1
    local playback = SV:getPlayback()
    local status = playback:getStatus()
    local head = playback:getPlayhead()
    if status == "looping" and head < self.lastPlayhead then
        self.loopStart = head
        self.loopEnd = self.lastPlayhead
    end
    if status ~= "stopped" and self.lastStatus == "stopped" then
        self:publishNotes()
        self:refresh()
    elseif self:dueForRevisionCheck() then
        self:checkForEdits()
    end
    local view = viewMapping(nil)
    self.publisher:publishState({
        at = head,
        status = status,
        loop = self:loopBounds(),
        perBlick = view.perBlick,
        perSemitone = view.perSemitone,
        viewLeft = view.viewLeft,
        viewRight = view.viewRight,
        viewTop = view.viewTop,
        viewBottom = view.viewBottom,
        rev = self.revision
    })
    if status ~= self.lastStatus then
        self:refresh()
    end
    self.lastStatus = status
    self.lastPlayhead = head
end
function OverlayBridge.prototype.dueForRevisionCheck(self)
    local elapsed = (self.ticks - self.lastRevisionCheck) * CONFIG.tickInterval
    if elapsed < CONFIG.revisionInterval then
        return false
    end
    self.lastRevisionCheck = self.ticks
    return true
end
function OverlayBridge.prototype.checkForEdits(self)
    if currentRevision(nil) ~= self.revision then
        self:publishNotes()
        self:refresh()
    end
end
function OverlayBridge.prototype.publishNotes(self)
    do
        local function ____catch(____error)
            self.lastError = tostring(____error)
        end
        local ____try, ____hasReturned = pcall(function()
            local notes = collectNotes(nil)
            self.revision = currentRevision(nil)
            self.publisher:publishNotes(self.revision, notes)
            self.notesPublished = #notes
            self.lastError = "none"
        end)
        if not ____try then
            ____catch(____hasReturned)
        end
    end
end
function OverlayBridge.prototype.loopBounds(self)
    if self.loopStart == nil or self.loopEnd == nil then
        return nil
    end
    return {start = self.loopStart, ["end"] = self.loopEnd}
end
local bridge = __TS__New(OverlayBridge)
_G.getClientInfo = getClientInfoFactory(nil, SCRIPT_TITLE, {minEditorVersion = 131330, type = "SidePanelSection"})
_G.getSidePanelSectionState = function() return bridge:getState() end
return ____exports
 end,
["src.lua.smoke"] = function(...) 
local ____lualib = require("lualib_bundle")
local __TS__SourceMapTraceBack = ____lualib.__TS__SourceMapTraceBack
local ____exports = {}
local ____channels = require("src.lua.bridge.channels")
local hotChannel = ____channels.hotChannel
local ____model = require("src.lua.bridge.model")
local collectNotes = ____model.collectNotes
local currentRevision = ____model.currentRevision
local viewMapping = ____model.viewMapping
local ____paths = require("src.lua.bridge.paths")
local bridgeDirectory = ____paths.bridgeDirectory
local ____publisher = require("src.lua.bridge.publisher")
local createPublisher = ____publisher.createPublisher
local ____json = require("src.lua.json")
local encodeJson = ____json.encodeJson
local SCRIPT_TITLE = "voxpane Lua smoke"
local ticks = 0
local lastCallback = "none yet"
local lastNotes = 0
local lastError = "none"
local publisher = createPublisher(nil)
local notesButton = SV:create("WidgetValue")
local directory = bridgeDirectory(nil)
local diagnostics = directory ~= nil and hotChannel(nil, directory, "smoke.json", 512) or nil
local function report(self)
    if diagnostics ~= nil then
        diagnostics:publish(encodeJson(
            nil,
            {
                ticks = ticks,
                lastCallback = lastCallback,
                lastNotes = lastNotes,
                lastError = lastError,
                channels = publisher:describe()
            }
        ))
    end
end
notesButton:setValueChangeCallback(function(value)
    lastCallback = ((("button value=" .. tostring(value)) .. " (") .. type(value)) .. ")"
    do
        local function ____catch(____error)
            lastError = tostring(____error)
        end
        local ____try, ____hasReturned = pcall(function()
            local notes = collectNotes(nil)
            lastNotes = #notes
            publisher:publishNotes(
                currentRevision(nil),
                notes
            )
            lastError = "none"
        end)
        if not ____try then
            ____catch(____hasReturned)
        end
    end
    report(nil)
    SV:refreshSidePanel()
end)
local function loop(self)
    ticks = ticks + 1
    local playback = SV:getPlayback()
    local px = viewMapping(nil)
    publisher:publishState({
        at = playback:getPlayhead(),
        status = playback:getStatus(),
        loop = nil,
        perBlick = px.perBlick,
        perSemitone = px.perSemitone,
        viewLeft = px.viewLeft,
        viewRight = px.viewRight,
        viewTop = px.viewTop,
        viewBottom = px.viewBottom,
        rev = currentRevision(nil)
    })
    if ticks % 120 == 0 then
        report(nil)
        SV:refreshSidePanel()
    end
    SV:setTimeout(16, loop)
end
loop(nil)
_G.getClientInfo = function() return {
    name = SCRIPT_TITLE,
    category = "voxpane",
    author = "0x1F320",
    versionNumber = 1,
    minEditorVersion = 131330,
    type = "SidePanelSection"
} end
_G.getSidePanelSectionState = function() return {
    title = SCRIPT_TITLE,
    rows = {
        {
            type = "Label",
            text = "ticks: " .. tostring(ticks)
        },
        {
            type = "Label",
            text = "channels: " .. publisher:describe()
        },
        {type = "Label", text = "callback: " .. lastCallback},
        {
            type = "Label",
            text = "last notes published: " .. tostring(lastNotes)
        },
        {type = "Label", text = "last error: " .. lastError},
        {type = "Container", columns = {{type = "Button", text = "Publish notes", value = notesButton, width = 1}}}
    }
} end
return ____exports
 end,
}
local __TS__SourceMapTraceBack = require("lualib_bundle").__TS__SourceMapTraceBack
__TS__SourceMapTraceBack(debug.getinfo(1).short_src, {["2764"] = {line = 7, file = "client-info.ts"},["2765"] = {line = 11, file = "client-info.ts"},["2766"] = {line = 12, file = "client-info.ts"},["2767"] = {line = 13, file = "client-info.ts"},["2768"] = {line = 14, file = "client-info.ts"},["2769"] = {line = 15, file = "client-info.ts"},["2770"] = {line = 16, file = "client-info.ts"},["2771"] = {line = 17, file = "client-info.ts"},["2772"] = {line = 12, file = "client-info.ts"},["2773"] = {line = 19, file = "client-info.ts"},["2774"] = {line = 20, file = "client-info.ts"},["2776"] = {line = 22, file = "client-info.ts"},["2777"] = {line = 11, file = "client-info.ts"},["2778"] = {line = 7, file = "client-info.ts"},["2786"] = {line = 21, file = "json.ts"},["2787"] = {line = 22, file = "json.ts"},["2788"] = {line = 23, file = "json.ts"},["2789"] = {line = 24, file = "json.ts"},["2790"] = {line = 25, file = "json.ts"},["2791"] = {line = 26, file = "json.ts"},["2792"] = {line = 27, file = "json.ts"},["2793"] = {line = 28, file = "json.ts"},["2794"] = {line = 21, file = "json.ts"},["2795"] = {line = 31, file = "json.ts"},["2796"] = {line = 32, file = "json.ts"},["2797"] = {line = 32, file = "json.ts"},["2798"] = {line = 32, file = "json.ts"},["2799"] = {line = 32, file = "json.ts"},["2800"] = {line = 33, file = "json.ts"},["2801"] = {line = 34, file = "json.ts"},["2802"] = {line = 34, file = "json.ts"},["2803"] = {line = 34, file = "json.ts"},["2804"] = {line = 34, file = "json.ts"},["2805"] = {line = 32, file = "json.ts"},["2806"] = {line = 32, file = "json.ts"},["2807"] = {line = 36, file = "json.ts"},["2808"] = {line = 31, file = "json.ts"},["2809"] = {line = 39, file = "json.ts"},["2810"] = {line = 40, file = "json.ts"},["2811"] = {line = 41, file = "json.ts"},["2813"] = {line = 43, file = "json.ts"},["2814"] = {line = 44, file = "json.ts"},["2816"] = {line = 46, file = "json.ts"},["2817"] = {line = 39, file = "json.ts"},["2821"] = {line = 54, file = "json.ts"},["2822"] = {line = 55, file = "json.ts"},["2823"] = {line = 56, file = "json.ts"},["2825"] = {line = 59, file = "json.ts"},["2826"] = {line = 60, file = "json.ts"},["2827"] = {line = 61, file = "json.ts"},["2829"] = {line = 63, file = "json.ts"},["2830"] = {line = 64, file = "json.ts"},["2832"] = {line = 66, file = "json.ts"},["2833"] = {line = 67, file = "json.ts"},["2835"] = {line = 70, file = "json.ts"},["2836"] = {line = 71, file = "json.ts"},["2837"] = {line = 72, file = "json.ts"},["2838"] = {line = 73, file = "json.ts"},["2839"] = {line = 74, file = "json.ts"},["2841"] = {line = 75, file = "json.ts"},["2842"] = {line = 75, file = "json.ts"},["2843"] = {line = 76, file = "json.ts"},["2844"] = {line = 75, file = "json.ts"},["2847"] = {line = 78, file = "json.ts"},["2849"] = {line = 81, file = "json.ts"},["2850"] = {line = 84, file = "json.ts"},["2852"] = {line = 86, file = "json.ts"},["2853"] = {line = 54, file = "json.ts"},["2865"] = {line = 8, file = "sv-index.ts"},["2866"] = {line = 9, file = "sv-index.ts"},["2867"] = {line = 8, file = "sv-index.ts"},["2869"] = {line = 13, file = "sv-index.ts"},["2870"] = {line = 14, file = "sv-index.ts"},["2871"] = {line = 13, file = "sv-index.ts"},["2896"] = {line = 19, file = "codec.ts"},["2898"] = {line = 22, file = "codec.ts"},["2899"] = {line = 24, file = "codec.ts"},["2900"] = {line = 25, file = "codec.ts"},["2901"] = {line = 27, file = "codec.ts"},["2902"] = {line = 29, file = "codec.ts"},["2903"] = {line = 35, file = "codec.ts"},["2904"] = {line = 36, file = "codec.ts"},["2905"] = {line = 36, file = "codec.ts"},["2906"] = {line = 36, file = "codec.ts"},["2907"] = {line = 36, file = "codec.ts"},["2908"] = {line = 36, file = "codec.ts"},["2909"] = {line = 36, file = "codec.ts"},["2910"] = {line = 36, file = "codec.ts"},["2911"] = {line = 35, file = "codec.ts"},["2912"] = {line = 57, file = "codec.ts"},["2913"] = {line = 59, file = "codec.ts"},["2914"] = {line = 60, file = "codec.ts"},["2915"] = {line = 65, file = "codec.ts"},["2916"] = {line = 66, file = "codec.ts"},["2917"] = {line = 67, file = "codec.ts"},["2918"] = {line = 68, file = "codec.ts"},["2919"] = {line = 69, file = "codec.ts"},["2920"] = {line = 70, file = "codec.ts"},["2921"] = {line = 71, file = "codec.ts"},["2922"] = {line = 72, file = "codec.ts"},["2923"] = {line = 73, file = "codec.ts"},["2924"] = {line = 74, file = "codec.ts"},["2925"] = {line = 65, file = "codec.ts"},["2926"] = {line = 76, file = "codec.ts"},["2927"] = {line = 78, file = "codec.ts"},["2929"] = {line = 79, file = "codec.ts"},["2930"] = {line = 80, file = "codec.ts"},["2931"] = {line = 81, file = "codec.ts"},["2932"] = {line = 82, file = "codec.ts"},["2933"] = {line = 83, file = "codec.ts"},["2934"] = {line = 84, file = "codec.ts"},["2936"] = {line = 85, file = "codec.ts"},["2937"] = {line = 76, file = "codec.ts"},["2938"] = {line = 76, file = "codec.ts"},["2939"] = {line = 76, file = "codec.ts"},["2940"] = {line = 78, file = "codec.ts"},["2941"] = {line = 76, file = "codec.ts"},["2942"] = {line = 59, file = "codec.ts"},["2946"] = {line = 105, file = "codec.ts"},["2947"] = {line = 107, file = "codec.ts"},["2948"] = {line = 108, file = "codec.ts"},["2949"] = {line = 109, file = "codec.ts"},["2950"] = {line = 110, file = "codec.ts"},["2952"] = {line = 112, file = "codec.ts"},["2953"] = {line = 113, file = "codec.ts"},["2954"] = {line = 114, file = "codec.ts"},["2955"] = {line = 107, file = "codec.ts"},["2956"] = {line = 117, file = "codec.ts"},["2957"] = {line = 118, file = "codec.ts"},["2959"] = {line = 119, file = "codec.ts"},["2960"] = {line = 119, file = "codec.ts"},["2961"] = {line = 120, file = "codec.ts"},["2962"] = {line = 121, file = "codec.ts"},["2963"] = {line = 122, file = "codec.ts"},["2964"] = {line = 123, file = "codec.ts"},["2965"] = {line = 124, file = "codec.ts"},["2966"] = {line = 125, file = "codec.ts"},["2967"] = {line = 126, file = "codec.ts"},["2968"] = {line = 127, file = "codec.ts"},["2969"] = {line = 128, file = "codec.ts"},["2970"] = {line = 129, file = "codec.ts"},["2971"] = {line = 130, file = "codec.ts"},["2972"] = {line = 122, file = "codec.ts"},["2973"] = {line = 132, file = "codec.ts"},["2974"] = {line = 133, file = "codec.ts"},["2975"] = {line = 133, file = "codec.ts"},["2976"] = {line = 133, file = "codec.ts"},["2977"] = {line = 133, file = "codec.ts"},["2979"] = {line = 135, file = "codec.ts"},["2980"] = {line = 119, file = "codec.ts"},["2983"] = {line = 137, file = "codec.ts"},["2984"] = {line = 137, file = "codec.ts"},["2985"] = {line = 137, file = "codec.ts"},["2986"] = {line = 137, file = "codec.ts"},["2987"] = {line = 137, file = "codec.ts"},["2988"] = {line = 117, file = "codec.ts"},["2995"] = {line = 11, file = "model.ts"},["2996"] = {line = 11, file = "model.ts"},["2997"] = {line = 23, file = "model.ts"},["2998"] = {line = 24, file = "model.ts"},["2999"] = {line = 23, file = "model.ts"},["3003"] = {line = 32, file = "model.ts"},["3004"] = {line = 33, file = "model.ts"},["3005"] = {line = 34, file = "model.ts"},["3006"] = {line = 35, file = "model.ts"},["3007"] = {line = 36, file = "model.ts"},["3008"] = {line = 37, file = "model.ts"},["3009"] = {line = 38, file = "model.ts"},["3010"] = {line = 39, file = "model.ts"},["3011"] = {line = 40, file = "model.ts"},["3012"] = {line = 41, file = "model.ts"},["3013"] = {line = 42, file = "model.ts"},["3014"] = {line = 36, file = "model.ts"},["3015"] = {line = 32, file = "model.ts"},["3019"] = {line = 51, file = "model.ts"},["3026"] = {line = 61, file = "model.ts"},["3028"] = {line = 64, file = "model.ts"},["3037"] = {line = 76, file = "model.ts"},["3049"] = {line = 91, file = "model.ts"},["3063"] = {line = 108, file = "model.ts"},["3064"] = {line = 113, file = "model.ts"},["3065"] = {line = 114, file = "model.ts"},["3066"] = {line = 115, file = "model.ts"},["3068"] = {line = 117, file = "model.ts"},["3069"] = {line = 125, file = "model.ts"},["3070"] = {line = 126, file = "model.ts"},["3072"] = {line = 128, file = "model.ts"},["3073"] = {line = 108, file = "model.ts"},["3077"] = {line = 136, file = "model.ts"},["3078"] = {line = 144, file = "model.ts"},["3079"] = {line = 145, file = "model.ts"},["3080"] = {line = 146, file = "model.ts"},["3081"] = {line = 147, file = "model.ts"},["3082"] = {line = 148, file = "model.ts"},["3084"] = {line = 151, file = "model.ts"},["3085"] = {line = 152, file = "model.ts"},["3086"] = {line = 153, file = "model.ts"},["3087"] = {line = 154, file = "model.ts"},["3088"] = {line = 155, file = "model.ts"},["3090"] = {line = 156, file = "model.ts"},["3091"] = {line = 156, file = "model.ts"},["3092"] = {line = 159, file = "model.ts"},["3093"] = {line = 159, file = "model.ts"},["3094"] = {line = 159, file = "model.ts"},["3095"] = {line = 159, file = "model.ts"},["3096"] = {line = 162, file = "model.ts"},["3097"] = {line = 163, file = "model.ts"},["3098"] = {line = 164, file = "model.ts"},["3099"] = {line = 164, file = "model.ts"},["3100"] = {line = 164, file = "model.ts"},["3101"] = {line = 164, file = "model.ts"},["3102"] = {line = 165, file = "model.ts"},["3103"] = {line = 166, file = "model.ts"},["3104"] = {line = 167, file = "model.ts"},["3106"] = {line = 169, file = "model.ts"},["3108"] = {line = 171, file = "model.ts"},["3109"] = {line = 156, file = "model.ts"},["3112"] = {line = 173, file = "model.ts"},["3113"] = {line = 174, file = "model.ts"},["3116"] = {line = 179, file = "model.ts"},["3117"] = {line = 179, file = "model.ts"},["3118"] = {line = 180, file = "model.ts"},["3119"] = {line = 181, file = "model.ts"},["3121"] = {line = 183, file = "model.ts"},["3122"] = {line = 184, file = "model.ts"},["3123"] = {line = 185, file = "model.ts"},["3125"] = {line = 179, file = "model.ts"},["3128"] = {line = 188, file = "model.ts"},["3129"] = {line = 136, file = "model.ts"},["3130"] = {line = 191, file = "model.ts"},["3131"] = {line = 192, file = "model.ts"},["3132"] = {line = 193, file = "model.ts"},["3133"] = {line = 194, file = "model.ts"},["3135"] = {line = 197, file = "model.ts"},["3136"] = {line = 198, file = "model.ts"},["3137"] = {line = 199, file = "model.ts"},["3138"] = {line = 200, file = "model.ts"},["3139"] = {line = 201, file = "model.ts"},["3141"] = {line = 203, file = "model.ts"},["3142"] = {line = 203, file = "model.ts"},["3143"] = {line = 204, file = "model.ts"},["3144"] = {line = 205, file = "model.ts"},["3145"] = {line = 206, file = "model.ts"},["3146"] = {line = 207, file = "model.ts"},["3147"] = {line = 208, file = "model.ts"},["3148"] = {line = 209, file = "model.ts"},["3149"] = {line = 210, file = "model.ts"},["3150"] = {line = 211, file = "model.ts"},["3151"] = {line = 212, file = "model.ts"},["3152"] = {line = 213, file = "model.ts"},["3153"] = {line = 207, file = "model.ts"},["3154"] = {line = 203, file = "model.ts"},["3157"] = {line = 217, file = "model.ts"},["3158"] = {line = 218, file = "model.ts"},["3159"] = {line = 219, file = "model.ts"},["3160"] = {line = 220, file = "model.ts"},["3161"] = {line = 221, file = "model.ts"},["3162"] = {line = 222, file = "model.ts"},["3163"] = {line = 222, file = "model.ts"},["3164"] = {line = 222, file = "model.ts"},["3165"] = {line = 222, file = "model.ts"},["3166"] = {line = 222, file = "model.ts"},["3167"] = {line = 222, file = "model.ts"},["3168"] = {line = 222, file = "model.ts"},["3172"] = {line = 226, file = "model.ts"},["3173"] = {line = 191, file = "model.ts"},["3174"] = {line = 229, file = "model.ts"},["3175"] = {line = 230, file = "model.ts"},["3176"] = {line = 231, file = "model.ts"},["3182"] = {line = 240, file = "model.ts"},["3183"] = {line = 241, file = "model.ts"},["3184"] = {line = 240, file = "model.ts"},["3185"] = {line = 244, file = "model.ts"},["3186"] = {line = 247, file = "model.ts"},["3187"] = {line = 247, file = "model.ts"},["3188"] = {line = 247, file = "model.ts"},["3189"] = {line = 247, file = "model.ts"},["3190"] = {line = 247, file = "model.ts"},["3191"] = {line = 244, file = "model.ts"},["3192"] = {line = 250, file = "model.ts"},["3193"] = {line = 251, file = "model.ts"},["3194"] = {line = 251, file = "model.ts"},["3195"] = {line = 251, file = "model.ts"},["3196"] = {line = 251, file = "model.ts"},["3197"] = {line = 251, file = "model.ts"},["3199"] = {line = 252, file = "model.ts"},["3200"] = {line = 252, file = "model.ts"},["3201"] = {line = 253, file = "model.ts"},["3202"] = {line = 253, file = "model.ts"},["3203"] = {line = 253, file = "model.ts"},["3204"] = {line = 253, file = "model.ts"},["3205"] = {line = 253, file = "model.ts"},["3206"] = {line = 252, file = "model.ts"},["3209"] = {line = 255, file = "model.ts"},["3210"] = {line = 250, file = "model.ts"},["3212"] = {line = 259, file = "model.ts"},["3213"] = {line = 260, file = "model.ts"},["3214"] = {line = 261, file = "model.ts"},["3215"] = {line = 262, file = "model.ts"},["3217"] = {line = 265, file = "model.ts"},["3218"] = {line = 266, file = "model.ts"},["3219"] = {line = 267, file = "model.ts"},["3221"] = {line = 269, file = "model.ts"},["3222"] = {line = 269, file = "model.ts"},["3223"] = {line = 270, file = "model.ts"},["3224"] = {line = 271, file = "model.ts"},["3225"] = {line = 271, file = "model.ts"},["3226"] = {line = 271, file = "model.ts"},["3227"] = {line = 271, file = "model.ts"},["3228"] = {line = 271, file = "model.ts"},["3229"] = {line = 272, file = "model.ts"},["3230"] = {line = 272, file = "model.ts"},["3231"] = {line = 272, file = "model.ts"},["3232"] = {line = 272, file = "model.ts"},["3233"] = {line = 272, file = "model.ts"},["3234"] = {line = 273, file = "model.ts"},["3235"] = {line = 273, file = "model.ts"},["3236"] = {line = 273, file = "model.ts"},["3237"] = {line = 273, file = "model.ts"},["3238"] = {line = 273, file = "model.ts"},["3239"] = {line = 274, file = "model.ts"},["3240"] = {line = 274, file = "model.ts"},["3241"] = {line = 274, file = "model.ts"},["3242"] = {line = 274, file = "model.ts"},["3243"] = {line = 274, file = "model.ts"},["3244"] = {line = 269, file = "model.ts"},["3247"] = {line = 276, file = "model.ts"},["3248"] = {line = 259, file = "model.ts"},["3261"] = {line = 10, file = "paths.ts"},["3262"] = {line = 11, file = "paths.ts"},["3263"] = {line = 16, file = "paths.ts"},["3264"] = {line = 16, file = "paths.ts"},["3265"] = {line = 16, file = "paths.ts"},["3266"] = {line = 16, file = "paths.ts"},["3267"] = {line = 16, file = "paths.ts"},["3268"] = {line = 16, file = "paths.ts"},["3269"] = {line = 17, file = "paths.ts"},["3270"] = {line = 19, file = "paths.ts"},["3271"] = {line = 20, file = "paths.ts"},["3272"] = {line = 21, file = "paths.ts"},["3273"] = {line = 22, file = "paths.ts"},["3275"] = {line = 24, file = "paths.ts"},["3276"] = {line = 25, file = "paths.ts"},["3277"] = {line = 19, file = "paths.ts"},["3278"] = {line = 30, file = "paths.ts"},["3279"] = {line = 31, file = "paths.ts"},["3280"] = {line = 30, file = "paths.ts"},["3287"] = {line = 22, file = "channels.ts"},["3288"] = {line = 22, file = "channels.ts"},["3289"] = {line = 30, file = "channels.ts"},["3290"] = {line = 34, file = "channels.ts"},["3291"] = {line = 35, file = "channels.ts"},["3292"] = {line = 36, file = "channels.ts"},["3293"] = {line = 37, file = "channels.ts"},["3295"] = {line = 39, file = "channels.ts"},["3296"] = {line = 40, file = "channels.ts"},["3297"] = {line = 41, file = "channels.ts"},["3299"] = {line = 43, file = "channels.ts"},["3300"] = {line = 30, file = "channels.ts"},["3304"] = {line = 51, file = "channels.ts"},["3305"] = {line = 52, file = "channels.ts"},["3306"] = {line = 53, file = "channels.ts"},["3307"] = {line = 55, file = "channels.ts"},["3308"] = {line = 56, file = "channels.ts"},["3309"] = {line = 57, file = "channels.ts"},["3310"] = {line = 58, file = "channels.ts"},["3312"] = {line = 60, file = "channels.ts"},["3313"] = {line = 61, file = "channels.ts"},["3314"] = {line = 62, file = "channels.ts"},["3315"] = {line = 63, file = "channels.ts"},["3318"] = {line = 66, file = "channels.ts"},["3319"] = {line = 67, file = "channels.ts"},["3320"] = {line = 67, file = "channels.ts"},["3321"] = {line = 67, file = "channels.ts"},["3322"] = {line = 67, file = "channels.ts"},["3323"] = {line = 68, file = "channels.ts"},["3324"] = {line = 71, file = "channels.ts"},["3325"] = {line = 72, file = "channels.ts"},["3326"] = {line = 73, file = "channels.ts"},["3328"] = {line = 75, file = "channels.ts"},["3329"] = {line = 56, file = "channels.ts"},["3330"] = {line = 77, file = "channels.ts"},["3331"] = {line = 78, file = "channels.ts"},["3332"] = {line = 79, file = "channels.ts"},["3333"] = {line = 80, file = "channels.ts"},["3335"] = {line = 77, file = "channels.ts"},["3336"] = {line = 55, file = "channels.ts"},["3337"] = {line = 51, file = "channels.ts"},["3342"] = {line = 92, file = "channels.ts"},["3343"] = {line = 93, file = "channels.ts"},["3344"] = {line = 94, file = "channels.ts"},["3345"] = {line = 96, file = "channels.ts"},["3346"] = {line = 97, file = "channels.ts"},["3347"] = {line = 98, file = "channels.ts"},["3348"] = {line = 99, file = "channels.ts"},["3349"] = {line = 100, file = "channels.ts"},["3350"] = {line = 101, file = "channels.ts"},["3353"] = {line = 104, file = "channels.ts"},["3354"] = {line = 105, file = "channels.ts"},["3355"] = {line = 106, file = "channels.ts"},["3356"] = {line = 107, file = "channels.ts"},["3357"] = {line = 108, file = "channels.ts"},["3358"] = {line = 109, file = "channels.ts"},["3360"] = {line = 111, file = "channels.ts"},["3361"] = {line = 97, file = "channels.ts"},["3362"] = {line = 113, file = "channels.ts"},["3363"] = {line = 114, file = "channels.ts"},["3364"] = {line = 115, file = "channels.ts"},["3365"] = {line = 116, file = "channels.ts"},["3367"] = {line = 113, file = "channels.ts"},["3368"] = {line = 96, file = "channels.ts"},["3369"] = {line = 92, file = "channels.ts"},["3376"] = {line = 142, file = "publisher.ts"},["3377"] = {line = 24, file = "publisher.ts"},["3378"] = {line = 24, file = "publisher.ts"},["3379"] = {line = 25, file = "publisher.ts"},["3380"] = {line = 25, file = "publisher.ts"},["3381"] = {line = 25, file = "publisher.ts"},["3382"] = {line = 26, file = "publisher.ts"},["3383"] = {line = 26, file = "publisher.ts"},["3384"] = {line = 26, file = "publisher.ts"},["3385"] = {line = 26, file = "publisher.ts"},["3386"] = {line = 27, file = "publisher.ts"},["3387"] = {line = 27, file = "publisher.ts"},["3388"] = {line = 142, file = "publisher.ts"},["3389"] = {line = 143, file = "publisher.ts"},["3390"] = {line = 144, file = "publisher.ts"},["3393"] = {line = 148, file = "publisher.ts"},["3394"] = {line = 149, file = "publisher.ts"},["3395"] = {line = 150, file = "publisher.ts"},["3396"] = {line = 151, file = "publisher.ts"},["3397"] = {line = 151, file = "publisher.ts"},["3398"] = {line = 152, file = "publisher.ts"},["3399"] = {line = 152, file = "publisher.ts"},["3400"] = {line = 153, file = "publisher.ts"},["3401"] = {line = 154, file = "publisher.ts"},["3402"] = {line = 154, file = "publisher.ts"},["3403"] = {line = 149, file = "publisher.ts"},["3405"] = {line = 29, file = "publisher.ts"},["3408"] = {line = 35, file = "publisher.ts"},["3409"] = {line = 37, file = "publisher.ts"},["3410"] = {line = 60, file = "publisher.ts"},["3411"] = {line = 61, file = "publisher.ts"},["3412"] = {line = 62, file = "publisher.ts"},["3413"] = {line = 63, file = "publisher.ts"},["3415"] = {line = 66, file = "publisher.ts"},["3416"] = {line = 67, file = "publisher.ts"},["3417"] = {line = 68, file = "publisher.ts"},["3418"] = {line = 70, file = "publisher.ts"},["3419"] = {line = 71, file = "publisher.ts"},["3420"] = {line = 72, file = "publisher.ts"},["3421"] = {line = 72, file = "publisher.ts"},["3422"] = {line = 73, file = "publisher.ts"},["3423"] = {line = 74, file = "publisher.ts"},["3424"] = {line = 75, file = "publisher.ts"},["3425"] = {line = 76, file = "publisher.ts"},["3426"] = {line = 82, file = "publisher.ts"},["3427"] = {line = 72, file = "publisher.ts"},["3428"] = {line = 72, file = "publisher.ts"},["3429"] = {line = 88, file = "publisher.ts"},["3430"] = {line = 91, file = "publisher.ts"},["3431"] = {line = 92, file = "publisher.ts"},["3433"] = {line = 95, file = "publisher.ts"},["3434"] = {line = 96, file = "publisher.ts"},["3435"] = {line = 97, file = "publisher.ts"},["3436"] = {line = 99, file = "publisher.ts"},["3437"] = {line = 100, file = "publisher.ts"},["3438"] = {line = 102, file = "publisher.ts"},["3439"] = {line = 103, file = "publisher.ts"},["3440"] = {line = 104, file = "publisher.ts"},["3441"] = {line = 106, file = "publisher.ts"},["3442"] = {line = 107, file = "publisher.ts"},["3443"] = {line = 108, file = "publisher.ts"},["3444"] = {line = 109, file = "publisher.ts"},["3445"] = {line = 110, file = "publisher.ts"},["3446"] = {line = 111, file = "publisher.ts"},["3447"] = {line = 112, file = "publisher.ts"},["3448"] = {line = 113, file = "publisher.ts"},["3449"] = {line = 114, file = "publisher.ts"},["3450"] = {line = 115, file = "publisher.ts"},["3451"] = {line = 116, file = "publisher.ts"},["3452"] = {line = 117, file = "publisher.ts"},["3453"] = {line = 105, file = "publisher.ts"},["3454"] = {line = 120, file = "publisher.ts"},["3455"] = {line = 121, file = "publisher.ts"},["3457"] = {line = 102, file = "publisher.ts"},["3458"] = {line = 125, file = "publisher.ts"},["3459"] = {line = 126, file = "publisher.ts"},["3460"] = {line = 127, file = "publisher.ts"},["3461"] = {line = 128, file = "publisher.ts"},["3463"] = {line = 125, file = "publisher.ts"},["3464"] = {line = 132, file = "publisher.ts"},["3465"] = {line = 133, file = "publisher.ts"},["3466"] = {line = 132, file = "publisher.ts"},["3467"] = {line = 136, file = "publisher.ts"},["3468"] = {line = 137, file = "publisher.ts"},["3469"] = {line = 136, file = "publisher.ts"},["3470"] = {line = 99, file = "publisher.ts"},["3471"] = {line = 60, file = "publisher.ts"},["3478"] = {line = 1, file = "button.ts"},["3479"] = {line = 2, file = "button.ts"},["3480"] = {line = 1, file = "button.ts"},["3487"] = {line = 1, file = "label.ts"},["3488"] = {line = 2, file = "label.ts"},["3489"] = {line = 1, file = "label.ts"},["3496"] = {line = 1, file = "row.ts"},["3497"] = {line = 2, file = "row.ts"},["3498"] = {line = 1, file = "row.ts"},["3505"] = {line = 2, file = "version.ts"},["3514"] = {line = 18, file = "overlay-bridge.ts"},["3515"] = {line = 18, file = "overlay-bridge.ts"},["3516"] = {line = 18, file = "overlay-bridge.ts"},["3517"] = {line = 18, file = "overlay-bridge.ts"},["3518"] = {line = 19, file = "overlay-bridge.ts"},["3519"] = {line = 19, file = "overlay-bridge.ts"},["3520"] = {line = 20, file = "overlay-bridge.ts"},["3521"] = {line = 20, file = "overlay-bridge.ts"},["3522"] = {line = 21, file = "overlay-bridge.ts"},["3523"] = {line = 21, file = "overlay-bridge.ts"},["3524"] = {line = 22, file = "overlay-bridge.ts"},["3525"] = {line = 22, file = "overlay-bridge.ts"},["3526"] = {line = 23, file = "overlay-bridge.ts"},["3527"] = {line = 23, file = "overlay-bridge.ts"},["3528"] = {line = 24, file = "overlay-bridge.ts"},["3529"] = {line = 24, file = "overlay-bridge.ts"},["3530"] = {line = 26, file = "overlay-bridge.ts"},["3531"] = {line = 28, file = "overlay-bridge.ts"},["3532"] = {line = 45, file = "overlay-bridge.ts"},["3533"] = {line = 45, file = "overlay-bridge.ts"},["3535"] = {line = 46, file = "overlay-bridge.ts"},["3536"] = {line = 47, file = "overlay-bridge.ts"},["3537"] = {line = 48, file = "overlay-bridge.ts"},["3538"] = {line = 49, file = "overlay-bridge.ts"},["3539"] = {line = 50, file = "overlay-bridge.ts"},["3540"] = {line = 51, file = "overlay-bridge.ts"},["3541"] = {line = 53, file = "overlay-bridge.ts"},["3542"] = {line = 54, file = "overlay-bridge.ts"},["3543"] = {line = 56, file = "overlay-bridge.ts"},["3544"] = {line = 57, file = "overlay-bridge.ts"},["3545"] = {line = 59, file = "overlay-bridge.ts"},["3546"] = {line = 60, file = "overlay-bridge.ts"},["3547"] = {line = 61, file = "overlay-bridge.ts"},["3548"] = {line = 64, file = "overlay-bridge.ts"},["3549"] = {line = 65, file = "overlay-bridge.ts"},["3550"] = {line = 66, file = "overlay-bridge.ts"},["3551"] = {line = 63, file = "overlay-bridge.ts"},["3552"] = {line = 69, file = "overlay-bridge.ts"},["3553"] = {line = 70, file = "overlay-bridge.ts"},["3554"] = {line = 75, file = "overlay-bridge.ts"},["3555"] = {line = 76, file = "overlay-bridge.ts"},["3556"] = {line = 77, file = "overlay-bridge.ts"},["3557"] = {line = 78, file = "overlay-bridge.ts"},["3558"] = {line = 79, file = "overlay-bridge.ts"},["3559"] = {line = 80, file = "overlay-bridge.ts"},["3560"] = {line = 80, file = "overlay-bridge.ts"},["3561"] = {line = 80, file = "overlay-bridge.ts"},["3562"] = {line = 80, file = "overlay-bridge.ts"},["3563"] = {line = 81, file = "overlay-bridge.ts"},["3564"] = {line = 82, file = "overlay-bridge.ts"},["3565"] = {line = 82, file = "overlay-bridge.ts"},["3566"] = {line = 82, file = "overlay-bridge.ts"},["3567"] = {line = 82, file = "overlay-bridge.ts"},["3568"] = {line = 83, file = "overlay-bridge.ts"},["3569"] = {line = 84, file = "overlay-bridge.ts"},["3570"] = {line = 85, file = "overlay-bridge.ts"},["3571"] = {line = 85, file = "overlay-bridge.ts"},["3572"] = {line = 85, file = "overlay-bridge.ts"},["3573"] = {line = 85, file = "overlay-bridge.ts"},["3574"] = {line = 86, file = "overlay-bridge.ts"},["3575"] = {line = 86, file = "overlay-bridge.ts"},["3576"] = {line = 86, file = "overlay-bridge.ts"},["3577"] = {line = 86, file = "overlay-bridge.ts"},["3578"] = {line = 77, file = "overlay-bridge.ts"},["3579"] = {line = 75, file = "overlay-bridge.ts"},["3580"] = {line = 69, file = "overlay-bridge.ts"},["3581"] = {line = 91, file = "overlay-bridge.ts"},["3582"] = {line = 92, file = "overlay-bridge.ts"},["3583"] = {line = 93, file = "overlay-bridge.ts"},["3584"] = {line = 91, file = "overlay-bridge.ts"},["3585"] = {line = 96, file = "overlay-bridge.ts"},["3588"] = {line = 109, file = "overlay-bridge.ts"},["3591"] = {line = 101, file = "overlay-bridge.ts"},["3592"] = {line = 102, file = "overlay-bridge.ts"},["3594"] = {line = 104, file = "overlay-bridge.ts"},["3600"] = {line = 111, file = "overlay-bridge.ts"},["3601"] = {line = 111, file = "overlay-bridge.ts"},["3602"] = {line = 111, file = "overlay-bridge.ts"},["3603"] = {line = 111, file = "overlay-bridge.ts"},["3606"] = {line = 96, file = "overlay-bridge.ts"},["3607"] = {line = 120, file = "overlay-bridge.ts"},["3610"] = {line = 122, file = "overlay-bridge.ts"},["3613"] = {line = 120, file = "overlay-bridge.ts"},["3614"] = {line = 128, file = "overlay-bridge.ts"},["3615"] = {line = 129, file = "overlay-bridge.ts"},["3616"] = {line = 131, file = "overlay-bridge.ts"},["3617"] = {line = 132, file = "overlay-bridge.ts"},["3618"] = {line = 133, file = "overlay-bridge.ts"},["3619"] = {line = 138, file = "overlay-bridge.ts"},["3620"] = {line = 139, file = "overlay-bridge.ts"},["3621"] = {line = 140, file = "overlay-bridge.ts"},["3623"] = {line = 145, file = "overlay-bridge.ts"},["3624"] = {line = 148, file = "overlay-bridge.ts"},["3625"] = {line = 149, file = "overlay-bridge.ts"},["3626"] = {line = 150, file = "overlay-bridge.ts"},["3627"] = {line = 151, file = "overlay-bridge.ts"},["3629"] = {line = 154, file = "overlay-bridge.ts"},["3630"] = {line = 155, file = "overlay-bridge.ts"},["3631"] = {line = 156, file = "overlay-bridge.ts"},["3632"] = {line = 157, file = "overlay-bridge.ts"},["3633"] = {line = 158, file = "overlay-bridge.ts"},["3634"] = {line = 159, file = "overlay-bridge.ts"},["3635"] = {line = 160, file = "overlay-bridge.ts"},["3636"] = {line = 161, file = "overlay-bridge.ts"},["3637"] = {line = 162, file = "overlay-bridge.ts"},["3638"] = {line = 163, file = "overlay-bridge.ts"},["3639"] = {line = 164, file = "overlay-bridge.ts"},["3640"] = {line = 165, file = "overlay-bridge.ts"},["3641"] = {line = 155, file = "overlay-bridge.ts"},["3642"] = {line = 168, file = "overlay-bridge.ts"},["3643"] = {line = 169, file = "overlay-bridge.ts"},["3645"] = {line = 171, file = "overlay-bridge.ts"},["3646"] = {line = 172, file = "overlay-bridge.ts"},["3647"] = {line = 128, file = "overlay-bridge.ts"},["3648"] = {line = 175, file = "overlay-bridge.ts"},["3649"] = {line = 176, file = "overlay-bridge.ts"},["3650"] = {line = 177, file = "overlay-bridge.ts"},["3651"] = {line = 178, file = "overlay-bridge.ts"},["3653"] = {line = 180, file = "overlay-bridge.ts"},["3654"] = {line = 181, file = "overlay-bridge.ts"},["3655"] = {line = 175, file = "overlay-bridge.ts"},["3656"] = {line = 184, file = "overlay-bridge.ts"},["3657"] = {line = 185, file = "overlay-bridge.ts"},["3658"] = {line = 186, file = "overlay-bridge.ts"},["3659"] = {line = 187, file = "overlay-bridge.ts"},["3661"] = {line = 184, file = "overlay-bridge.ts"},["3662"] = {line = 197, file = "overlay-bridge.ts"},["3665"] = {line = 205, file = "overlay-bridge.ts"},["3668"] = {line = 199, file = "overlay-bridge.ts"},["3669"] = {line = 200, file = "overlay-bridge.ts"},["3670"] = {line = 201, file = "overlay-bridge.ts"},["3671"] = {line = 202, file = "overlay-bridge.ts"},["3672"] = {line = 203, file = "overlay-bridge.ts"},["3678"] = {line = 197, file = "overlay-bridge.ts"},["3679"] = {line = 209, file = "overlay-bridge.ts"},["3680"] = {line = 210, file = "overlay-bridge.ts"},["3681"] = {line = 211, file = "overlay-bridge.ts"},["3683"] = {line = 213, file = "overlay-bridge.ts"},["3684"] = {line = 209, file = "overlay-bridge.ts"},["3685"] = {line = 217, file = "overlay-bridge.ts"},["3686"] = {line = 219, file = "overlay-bridge.ts"},["3687"] = {line = 223, file = "overlay-bridge.ts"},["3694"] = {line = 12, file = "smoke.ts"},["3695"] = {line = 12, file = "smoke.ts"},["3696"] = {line = 13, file = "smoke.ts"},["3697"] = {line = 13, file = "smoke.ts"},["3698"] = {line = 13, file = "smoke.ts"},["3699"] = {line = 13, file = "smoke.ts"},["3700"] = {line = 14, file = "smoke.ts"},["3701"] = {line = 14, file = "smoke.ts"},["3702"] = {line = 15, file = "smoke.ts"},["3703"] = {line = 15, file = "smoke.ts"},["3704"] = {line = 16, file = "smoke.ts"},["3705"] = {line = 16, file = "smoke.ts"},["3706"] = {line = 18, file = "smoke.ts"},["3707"] = {line = 20, file = "smoke.ts"},["3708"] = {line = 21, file = "smoke.ts"},["3709"] = {line = 22, file = "smoke.ts"},["3710"] = {line = 23, file = "smoke.ts"},["3711"] = {line = 25, file = "smoke.ts"},["3712"] = {line = 26, file = "smoke.ts"},["3713"] = {line = 29, file = "smoke.ts"},["3714"] = {line = 30, file = "smoke.ts"},["3715"] = {line = 32, file = "smoke.ts"},["3716"] = {line = 33, file = "smoke.ts"},["3717"] = {line = 33, file = "smoke.ts"},["3718"] = {line = 34, file = "smoke.ts"},["3719"] = {line = 34, file = "smoke.ts"},["3720"] = {line = 35, file = "smoke.ts"},["3721"] = {line = 36, file = "smoke.ts"},["3722"] = {line = 37, file = "smoke.ts"},["3723"] = {line = 38, file = "smoke.ts"},["3724"] = {line = 39, file = "smoke.ts"},["3725"] = {line = 34, file = "smoke.ts"},["3726"] = {line = 34, file = "smoke.ts"},["3728"] = {line = 32, file = "smoke.ts"},["3729"] = {line = 44, file = "smoke.ts"},["3730"] = {line = 45, file = "smoke.ts"},["3733"] = {line = 52, file = "smoke.ts"},["3736"] = {line = 47, file = "smoke.ts"},["3737"] = {line = 48, file = "smoke.ts"},["3738"] = {line = 49, file = "smoke.ts"},["3739"] = {line = 49, file = "smoke.ts"},["3740"] = {line = 49, file = "smoke.ts"},["3741"] = {line = 49, file = "smoke.ts"},["3742"] = {line = 50, file = "smoke.ts"},["3748"] = {line = 54, file = "smoke.ts"},["3749"] = {line = 55, file = "smoke.ts"},["3750"] = {line = 44, file = "smoke.ts"},["3751"] = {line = 58, file = "smoke.ts"},["3752"] = {line = 59, file = "smoke.ts"},["3753"] = {line = 60, file = "smoke.ts"},["3754"] = {line = 61, file = "smoke.ts"},["3755"] = {line = 62, file = "smoke.ts"},["3756"] = {line = 63, file = "smoke.ts"},["3757"] = {line = 64, file = "smoke.ts"},["3758"] = {line = 65, file = "smoke.ts"},["3759"] = {line = 66, file = "smoke.ts"},["3760"] = {line = 67, file = "smoke.ts"},["3761"] = {line = 68, file = "smoke.ts"},["3762"] = {line = 69, file = "smoke.ts"},["3763"] = {line = 70, file = "smoke.ts"},["3764"] = {line = 71, file = "smoke.ts"},["3765"] = {line = 72, file = "smoke.ts"},["3766"] = {line = 62, file = "smoke.ts"},["3767"] = {line = 76, file = "smoke.ts"},["3768"] = {line = 77, file = "smoke.ts"},["3769"] = {line = 78, file = "smoke.ts"},["3771"] = {line = 80, file = "smoke.ts"},["3772"] = {line = 58, file = "smoke.ts"},["3773"] = {line = 83, file = "smoke.ts"},["3774"] = {line = 85, file = "smoke.ts"},["3775"] = {line = 86, file = "smoke.ts"},["3776"] = {line = 87, file = "smoke.ts"},["3777"] = {line = 88, file = "smoke.ts"},["3778"] = {line = 89, file = "smoke.ts"},["3779"] = {line = 90, file = "smoke.ts"},["3780"] = {line = 91, file = "smoke.ts"},["3781"] = {line = 85, file = "smoke.ts"},["3782"] = {line = 94, file = "smoke.ts"},["3783"] = {line = 95, file = "smoke.ts"},["3784"] = {line = 96, file = "smoke.ts"},["3785"] = {line = 97, file = "smoke.ts"},["3786"] = {line = 97, file = "smoke.ts"},["3787"] = {line = 97, file = "smoke.ts"},["3788"] = {line = 97, file = "smoke.ts"},["3789"] = {line = 98, file = "smoke.ts"},["3790"] = {line = 98, file = "smoke.ts"},["3791"] = {line = 98, file = "smoke.ts"},["3792"] = {line = 98, file = "smoke.ts"},["3793"] = {line = 99, file = "smoke.ts"},["3794"] = {line = 100, file = "smoke.ts"},["3795"] = {line = 100, file = "smoke.ts"},["3796"] = {line = 100, file = "smoke.ts"},["3797"] = {line = 100, file = "smoke.ts"},["3798"] = {line = 101, file = "smoke.ts"},["3799"] = {line = 102, file = "smoke.ts"},["3800"] = {line = 96, file = "smoke.ts"},["3801"] = {line = 94, file = "smoke.ts"}});
local ____entry = require("src.lua.overlay-bridge", ...)
return ____entry
