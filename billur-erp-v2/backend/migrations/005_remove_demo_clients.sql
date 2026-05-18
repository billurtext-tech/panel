-- Eski UI mock klientlarini olib tashlash (Zara, H&M, Mango va h.k.)
-- Faqat demo nom/kod bo'yicha; haqiqiy mijozlarga tegmaydi.

UPDATE clients
SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (
    name ILIKE '%Zara%'
    OR name ILIKE '%H&M%'
    OR name ILIKE '%H and M%'
    OR name ILIKE '%Mango Spain%'
    OR name ILIKE '%Mango %'
    OR code IN ('zara', 'hm', 'h-m', 'mango', 'ZARA', 'HM', 'MANGO')
  );
