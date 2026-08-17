// Package lang identifies what a project is built with. Framework knowledge
// lives here as a single table, so supporting a new one is a row rather than a
// new code path.
package lang

// ID names a web framework.
type ID string

const (
	NetHTTP ID = "net/http"
	Chi     ID = "chi"
	Gin     ID = "gin"
	Echo    ID = "echo"
	Fiber   ID = "fiber"
	Express ID = "express"
	Fastify ID = "fastify"
	NestJS  ID = "nestjs"
	FastAPI ID = "fastapi"
	Flask   ID = "flask"
	Django  ID = "django"
	Rails   ID = "rails"
	Laravel ID = "laravel"
	Spring  ID = "spring"
	ASPNET  ID = "asp.net"
)

// Framework is one row of the table. Dep is the dependency name as a manifest
// spells it; an empty Dep means the framework can only be spotted from imports,
// which is the case for anything in a standard library.
type Framework struct {
	ID       ID
	Language string
	Dep      string
	Static   bool // GritQA can read routes straight from this framework's source
}

// Frameworks is every framework GritQA can name. Static separates the ones it
// can read from the ones it can only recognise — and recognising Django is
// still worth doing, because "I know what this is and cannot read it yet" beats
// reporting zero endpoints.
var Frameworks = []Framework{
	{ID: NetHTTP, Language: "go", Static: true},
	{ID: Chi, Language: "go", Dep: "github.com/go-chi/chi", Static: true},
	{ID: Gin, Language: "go", Dep: "github.com/gin-gonic/gin", Static: true},
	{ID: Echo, Language: "go", Dep: "github.com/labstack/echo", Static: true},
	{ID: Fiber, Language: "go", Dep: "github.com/gofiber/fiber", Static: true},

	{ID: Express, Language: "javascript", Dep: "express"},
	{ID: Fastify, Language: "javascript", Dep: "fastify"},
	{ID: NestJS, Language: "typescript", Dep: "@nestjs/core"},

	{ID: FastAPI, Language: "python", Dep: "fastapi"},
	{ID: Flask, Language: "python", Dep: "flask"},
	{ID: Django, Language: "python", Dep: "django"},

	{ID: Rails, Language: "ruby", Dep: "rails"},
	{ID: Laravel, Language: "php", Dep: "laravel/framework"},
	{ID: Spring, Language: "java", Dep: "spring-boot"},
	{ID: ASPNET, Language: "csharp", Dep: "Microsoft.AspNetCore"},
}

// Find returns the table row for an ID.
func Find(id ID) (Framework, bool) {
	for _, f := range Frameworks {
		if f.ID == id {
			return f, true
		}
	}
	return Framework{}, false
}

// Order dedupes ids and returns them in table order, so two runs over an
// unchanged project report frameworks the same way round.
func Order(ids []ID) []ID {
	want := make(map[ID]bool, len(ids))
	for _, id := range ids {
		want[id] = true
	}

	out := make([]ID, 0, len(want))
	for _, f := range Frameworks {
		if want[f.ID] {
			out = append(out, f.ID)
		}
	}
	return out
}

// Readable reports whether any of these frameworks can be read from source. It
// is the difference between "I found no endpoints" and "I cannot read this kind
// of project yet".
func Readable(ids []ID) bool {
	for _, id := range ids {
		if f, ok := Find(id); ok && f.Static {
			return true
		}
	}
	return false
}

// Unreadable returns the frameworks GritQA can name but not yet read, so it can
// say which ones it is stuck on.
func Unreadable(ids []ID) []ID {
	var out []ID
	for _, id := range Order(ids) {
		if f, ok := Find(id); ok && !f.Static {
			out = append(out, id)
		}
	}
	return out
}
