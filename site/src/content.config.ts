import { defineCollection, z } from 'astro:content';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';

export const collections = {
  // `familia`: "Monotributo · C" en las páginas de comprobantes; `PageTitle.astro` la muestra arriba del título.
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({ extend: z.object({ familia: z.string().optional() }) }),
  }),
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
