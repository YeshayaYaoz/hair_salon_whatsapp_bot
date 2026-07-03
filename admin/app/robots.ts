import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard/", "/login", "/forgot-password", "/reset-password", "/book/"],
      },
    ],
    sitemap: "https://torionline.com/sitemap.xml",
    host: "https://torionline.com",
  };
}
