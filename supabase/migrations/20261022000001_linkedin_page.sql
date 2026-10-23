-- Postbiz : canal « Page LinkedIn » (organisation), distinct du profil personnel « LinkedIn ».
-- Même application LinkedIn et même publication (le worker lit settings.author_urn = urn:li:organization:<id>), mais
-- des permissions et un flux de connexion à part : on le range sous son propre fournisseur pour le distinguer partout.

alter type public.social_provider add value if not exists 'linkedin_page';
