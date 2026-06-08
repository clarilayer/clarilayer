-- Net revenue = captured payments minus refunds. Refunds are NOT revenue.
-- This is exactly the kind of definition an agent gets wrong without context
-- (it counts refunds as positive). Save it, then `reconcile` it.
SELECT
    date_trunc('month', p.captured_at)                              AS month,
    sum(CASE WHEN p.type = 'charge'  THEN p.amount_cents ELSE 0 END) / 100.0
      - sum(CASE WHEN p.type = 'refund' THEN p.amount_cents ELSE 0 END) / 100.0
                                                                     AS net_revenue
FROM payments p
WHERE p.status = 'succeeded'
GROUP BY 1
ORDER BY 1;
