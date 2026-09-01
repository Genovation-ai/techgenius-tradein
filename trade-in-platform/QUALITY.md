# Trade-in platform quality notes

Aligned with gstack-style engineering rigor (review before ship):

- Tests + `tsc` + `oxlint` must pass before shipping embed
- Embed must not restyle host `html`/`body` (scoped via `.tg-trade-in-host`)
- No third-party buyback SaaS dependency (no Reusely)
- Customer copy must match real behavior (no fake email/shipping promises)
- Competitor prices never shown to customers
