-- Comments are searchable ("blue PETG", "chunkier"): one row of kind 'comment' per live comment, with its
-- idea's or build's title, so the hit leads to the thread. A deleted comment drops out, an undone delete comes
-- back, an edit updates the row. The item triggers of 0003 already follow the title and the item's removal
-- (they work on every row of the item).
CREATE TRIGGER `search_comments_insert` AFTER INSERT ON `comments` WHEN NEW.deleted_at IS NULL BEGIN
	INSERT INTO search (kind, ref_id, item_id, title, body)
	SELECT 'comment', NEW.id, NEW.item_id, coalesce(i.title, ''), NEW.body FROM items AS i WHERE i.id = NEW.item_id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_comments_update` AFTER UPDATE OF body, deleted_at ON `comments` BEGIN
	DELETE FROM search WHERE kind = 'comment' AND ref_id = OLD.id;
	INSERT INTO search (kind, ref_id, item_id, title, body)
	SELECT 'comment', NEW.id, NEW.item_id, coalesce(i.title, ''), NEW.body FROM items AS i WHERE i.id = NEW.item_id AND NEW.deleted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `search_comments_delete` AFTER DELETE ON `comments` BEGIN
	DELETE FROM search WHERE kind = 'comment' AND ref_id = OLD.id;
END;
--> statement-breakpoint
INSERT INTO search (kind, ref_id, item_id, title, body)
SELECT 'comment', c.id, c.item_id, coalesce(i.title, ''), c.body FROM comments AS c JOIN items AS i ON i.id = c.item_id WHERE c.deleted_at IS NULL;
