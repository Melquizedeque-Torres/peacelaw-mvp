import { Faq } from "@/features/landing/Faq";
import { Footer } from "@/features/landing/Footer";
import { ForProfessionals } from "@/features/landing/ForProfessionals";
import { Hero } from "@/features/landing/Hero";
import { HowItWorks } from "@/features/landing/HowItWorks";
import { PrivacyPromises } from "@/features/landing/PrivacyPromises";
import { RoleRedirect } from "@/features/landing/RoleRedirect";

export default function HomePage() {
  return (
    <>
      <main>
        <RoleRedirect />
        <Hero />
        <HowItWorks />
        <PrivacyPromises />
        <ForProfessionals />
        <Faq />
      </main>
      <Footer />
    </>
  );
}
