# Summarise the corpus.
library(stats)

summarise <- function(values) {
  m <- mean(values)   # arithmetic mean
  cat("value # not a comment\n")
  m
}

summarise(c(1, 2, 3))
