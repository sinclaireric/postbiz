-- Postbiz : connexion « Instagram Standalone » (Instagram Login, sans Page Facebook).
-- Le compte connecté est enregistré comme un canal `instagram` ordinaire (settings.login = 'instagram', settings.graph_host = 'graph.instagram.com') :
-- la boîte de réception et l'envoi de messages le traitent comme les autres. Cette valeur ne sert qu'à désigner le point d'entrée de connexion
-- (table oauth_states), qui ne peut pas porter le même nom que la connexion par Page.

alter type public.social_provider add value if not exists 'instagram_standalone';
