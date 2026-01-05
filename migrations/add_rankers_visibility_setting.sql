-- Add Top Rankers visibility setting to system_settings table
-- This controls whether the Top Rankers section is displayed on the homepage

INSERT INTO system_settings (setting_key, setting_value, description)
VALUES (
    'show_rankers_on_homepage',
    'false',
    'Controls whether the Top Rankers section is displayed on the homepage'
)
ON CONFLICT (setting_key) DO NOTHING;

-- Add comment
COMMENT ON TABLE system_settings IS 'Stores system-wide configuration settings';
