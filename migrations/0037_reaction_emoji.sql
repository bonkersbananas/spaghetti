-- Reactions are any emoji now (decision 0042): the six kinds become the emoji they were drawn as, so none is lost.
UPDATE `reactions` SET `kind` = CASE `kind`
	WHEN 'love' THEN '❤️'
	WHEN 'chef' THEN '🤌'
	WHEN 'want' THEN '🤩'
	WHEN 'hot' THEN '🔥'
	WHEN 'bravo' THEN '👏'
	WHEN 'melt' THEN '🫠'
	ELSE `kind`
END
WHERE `kind` IN ('love', 'chef', 'want', 'hot', 'bravo', 'melt');
