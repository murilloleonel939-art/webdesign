import type { Section } from "@webdesign/site-schema";

// Componentes puros de seccion (spec 6.2 y 6.3). No usan estado, efectos ni
// eventos: el editor los envuelve y el renderer los convierte a HTML estatico.
// Todo el texto entra como hijos de React, que escapa por si mismo.

export interface SectionProps {
  section: Section;
  // El editor no debe enlazar de verdad: dentro del editor se anula el href.
  editing?: boolean;
}

function safeHref(href: string, editing?: boolean): string | undefined {
  return editing ? undefined : href;
}

function Cta(props: { cta?: { label?: unknown; href?: unknown } | undefined; editing?: boolean | undefined }) {
  const label = typeof props.cta?.label === "string" ? props.cta.label : undefined;
  const href = typeof props.cta?.href === "string" ? props.cta.href : undefined;
  if (!label || !href) return null;
  const external = /^https?:/i.test(href);
  return (
    <a className="cta" href={safeHref(href, props.editing)} rel={external ? "noopener noreferrer" : undefined}>
      {label}
    </a>
  );
}

export function HeroSection({ section, editing }: SectionProps) {
  const p = section.props as { headline?: unknown; subline?: unknown; cta?: { label?: string; href?: string } };
  const headline = typeof p.headline === "string" ? p.headline : "";
  const subline = typeof p.subline === "string" ? p.subline : undefined;
  return (
    <section className={`hero hero--${section.variant ?? "default"}`} data-section-id={section.id}>
      <h1>{headline}</h1>
      {subline ? <p>{subline}</p> : null}
      <Cta cta={p.cta} editing={editing} />
    </section>
  );
}

export function TextSection({ section }: SectionProps) {
  const body = typeof (section.props as { body?: unknown }).body === "string" ? ((section.props as { body: string }).body) : "";
  return (
    <section className="text" data-section-id={section.id}>
      {body.split(/\n{2,}/).map((para, i) => (
        <p key={i}>{para}</p>
      ))}
    </section>
  );
}

export function ImageSection({ section, resolveAsset }: SectionProps & { resolveAsset?: (id: string) => { src: string; alt: string } | undefined }) {
  const p = section.props as { assetId?: unknown; alt?: unknown };
  const assetId = typeof p.assetId === "string" ? p.assetId : "";
  const resolved = resolveAsset?.(assetId);
  if (!resolved) return <section className="image" data-section-id={section.id} />;
  const alt = typeof p.alt === "string" ? p.alt : resolved.alt;
  return (
    <section className="image" data-section-id={section.id}>
      <img src={resolved.src} alt={alt} loading="lazy" decoding="async" />
    </section>
  );
}

export function GallerySection({ section, resolveAsset }: SectionProps & { resolveAsset?: (id: string) => { src: string; alt: string } | undefined }) {
  const ids = Array.isArray((section.props as { assetIds?: unknown }).assetIds)
    ? ((section.props as { assetIds: string[] }).assetIds)
    : [];
  // Sin resolver de assets la galeria queda vacia: nunca se inventan rutas.
  const images = ids.map((id) => resolveAsset?.(id)).filter((a): a is { src: string; alt: string } => a !== undefined);
  return (
    <section className={`gallery gallery--${section.variant ?? "grid"}`} data-section-id={section.id}>
      {images.map((a, i) => (
        <img key={i} src={a.src} alt={a.alt} loading="lazy" decoding="async" />
      ))}
    </section>
  );
}

export function FeaturesSection({ section }: SectionProps) {
  const items = Array.isArray((section.props as { items?: unknown }).items)
    ? ((section.props as { items: { title: string; body: string }[] }).items)
    : [];
  return (
    <section className="features" data-section-id={section.id}>
      <ul>
        {items.map((it, i) => (
          <li key={i}>
            <h3>{it.title}</h3>
            <p>{it.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PricingSection({ section }: SectionProps) {
  const plans = Array.isArray((section.props as { plans?: unknown }).plans)
    ? ((section.props as { plans: { name: string; price: string; features: string[] }[] }).plans)
    : [];
  return (
    <section className="pricing" data-section-id={section.id}>
      {plans.map((plan, i) => (
        <article key={i} className="pricing__plan">
          <h3>{plan.name}</h3>
          <p className="pricing__price">{plan.price}</p>
          <ul>{Array.isArray(plan.features) ? plan.features.map((f, j) => <li key={j}>{f}</li>) : null}</ul>
        </article>
      ))}
    </section>
  );
}

export function TestimonialSection({ section }: SectionProps) {
  const p = section.props as { quote?: unknown; author?: unknown; ownerProvided?: unknown };
  // Sin la confirmacion del dueno no se publica el testimonio (spec 6.2).
  if (p.ownerProvided !== true) return <section className="testimonial" data-section-id={section.id} />;
  const quote = typeof p.quote === "string" ? p.quote : "";
  const author = typeof p.author === "string" ? p.author : "";
  return (
    <section className="testimonial" data-section-id={section.id}>
      <blockquote>{quote}</blockquote>
      <cite>{author}</cite>
    </section>
  );
}

export function FaqSection({ section }: SectionProps) {
  const items = Array.isArray((section.props as { items?: unknown }).items)
    ? ((section.props as { items: { q: string; a: string }[] }).items)
    : [];
  return (
    <section className="faq" data-section-id={section.id}>
      {items.map((it, i) => (
        <details key={i}>
          <summary>{it.q}</summary>
          <p>{it.a}</p>
        </details>
      ))}
    </section>
  );
}

export function ContactSection({ section }: SectionProps) {
  const p = section.props as { email?: unknown; phone?: unknown; cta?: { label?: string; href?: string } };
  const email = typeof p.email === "string" ? p.email : undefined;
  const phone = typeof p.phone === "string" ? p.phone : undefined;
  return (
    <section className="contact" data-section-id={section.id}>
      {email ? <a href={`mailto:${encodeURIComponent(email)}`}>{email}</a> : null}
      {phone ? <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a> : null}
      <Cta cta={p.cta} editing={false} />
    </section>
  );
}

export function CtaSection({ section, editing }: SectionProps) {
  const p = section.props as { headline?: unknown; cta?: { label?: string; href?: string } };
  const headline = typeof p.headline === "string" ? p.headline : "";
  return (
    <section className="cta-block" data-section-id={section.id}>
      <h2>{headline}</h2>
      <Cta cta={p.cta} editing={editing} />
    </section>
  );
}

// Mapa cerrado tipo -> componente. Un tipo desconocido no tiene componente.
export const SECTION_COMPONENTS = {
  hero: HeroSection,
  text: TextSection,
  image: ImageSection,
  gallery: GallerySection,
  features: FeaturesSection,
  pricing: PricingSection,
  testimonial: TestimonialSection,
  faq: FaqSection,
  contact: ContactSection,
  cta: CtaSection,
} as const;

export function renderSection(section: Section, opts: { editing?: boolean; resolveAsset?: (id: string) => { src: string; alt: string } | undefined } = {}) {
  const Component = SECTION_COMPONENTS[section.type];
  if (!Component) throw new Error(`unknown section type: ${section.type}`);
  return (
    <Component
      section={section}
      {...(opts.editing === undefined ? {} : { editing: opts.editing })}
      {...(opts.resolveAsset ? { resolveAsset: opts.resolveAsset } : {})}
    />
  );
}
