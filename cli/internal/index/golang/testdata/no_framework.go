package fixtures

import "context"

type Cache struct{}

func (c *Cache) Get(key string) ([]byte, bool) { return nil, false }
func (c *Cache) Put(key string, v []byte)      {}

// Nothing here is a route. Without the framework-import gate these read as
// GET /tmp/session and PUT /tmp/session.
func warmCache(ctx context.Context, c *Cache) {
	c.Get("/tmp/session")
	c.Put("/tmp/session", nil)
}
