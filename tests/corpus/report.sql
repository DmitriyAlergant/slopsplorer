-- Monthly totals.
SELECT
  date_trunc('month', created_at) AS month,   -- bucket
  count(*) AS total
/* A block comment
   over two lines. */
FROM orders
WHERE note <> '-- not a comment'
GROUP BY 1;
