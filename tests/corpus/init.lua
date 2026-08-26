-- Editor bootstrap.
local options = {
  number = true,   -- show line numbers
}

--[[
A block comment spanning lines.

With a blank line inside it.
]]
local function apply()
  print("-- not a comment")
  return options
end

return apply
