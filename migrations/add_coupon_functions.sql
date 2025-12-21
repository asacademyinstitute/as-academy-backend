-- Create function to increment coupon usage count
CREATE OR REPLACE FUNCTION increment_coupon_usage(coupon_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE coupons
    SET usage_count = usage_count + 1
    WHERE id = coupon_id;
END;
$$ LANGUAGE plpgsql;
