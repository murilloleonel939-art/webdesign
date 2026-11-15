-- Alta de la zona del pool (Fase 2, spec 5.3).
-- Sin al menos una zona, publicar no puede asignar hostname y ningun sitio se
-- sirve, aunque este `active` en la base. El `used` se recalcula desde los
-- dominios reales para que un redespliegue no lo infle.

INSERT INTO site_domain_pool (id, zone_id, domain, capacity, used, status)
VALUES (
  gen_random_uuid(),
  'zottaweb.site',
  'zottaweb.site',
  180,
  0,
  'active'
)
ON CONFLICT (domain) DO NOTHING;

-- El conteo real manda: si ya hay dominios asignados, `used` debe reflejarlos.
UPDATE site_domain_pool p
SET used = (
  SELECT count(*) FROM domains d
  WHERE d.kind = 'pool' AND d.status <> 'removed'
    AND lower(d.hostname) LIKE '%.' || lower(p.domain)
);
