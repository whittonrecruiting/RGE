import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/shell/coming-soon";
import { NAV_ITEMS } from "@/components/shell/nav-items";

// Placeholder for sections that are not built yet. A real page at a static
// segment (for example /mpcs) takes precedence over this one.
export const dynamicParams = false;

export function generateStaticParams() {
  return NAV_ITEMS.map((item) => ({ section: item.href.slice(1) }));
}

type Props = { params: Promise<{ section: string }> };

export async function generateMetadata({ params }: Props) {
  const { section } = await params;
  return { title: NAV_ITEMS.find((i) => i.href === `/${section}`)?.label };
}

export default async function SectionPage({ params }: Props) {
  const { section } = await params;
  const item = NAV_ITEMS.find((i) => i.href === `/${section}`);
  if (!item) notFound();
  return <ComingSoon title={item.label} />;
}
