package draft

import (
	"errors"
	"fmt"
	"strings"

	"github.com/tomiwa-a/gritqa/cli/internal/model"
	"github.com/tomiwa-a/gritqa/cli/internal/plan"
)

const system = `You write HTTP test plans for a backend API. You are given the files that just
changed, the endpoints they register, and the plans that already exist.

Reply with one JSON object and nothing else:

{
  "name": "short human title",
  "version": 1,
  "description": "one sentence on what this plan proves",
  "baseUrl": "the base url you were given",
  "variables": {"testEmail": "qa@example.com"},
  "steps": [
    {
      "id": "s1",
      "name": "what this step does",
      "description": "why it is here",
      "dependsOn": [],
      "request": {
        "method": "POST",
        "url": "/checkout/{{checkoutId}}/tax",
        "headers": {"Authorization": "Bearer {{authToken}}"},
        "body": {"region": "NG-LA"},
        "query": {}
      },
      "extract": [{"name": "authToken", "path": "$.data.token", "source": "body"}],
      "assertions": [
        {"type": "status", "operator": "equals", "target": "status", "expected": 200},
        {"type": "bodyField", "operator": "equals", "target": "data.tax_total", "expected": "{{taxTotal}}"}
      ],
      "onFailure": "abort",
      "retry": {"maxAttempts": 2, "delayMs": 250}
    }
  ]
}

Rules:
- No field other than the ones above. No markdown fence, no prose, no comments.
- type is one of status, bodyField, header, responseTime.
- operator is one of equals, notEquals, contains, notContains, exists, lt, gt.
  Everything except exists needs "expected".
- extract paths are written $.a.b, bodyField targets are written a.b. source is
  body or header, and a header path is the header name.
- {{name}} reads a variable in any url, header, body value, query value or
  expected value. Only a variable the plan seeds, an earlier step extracts, or
  one you are told is already seeded.
- There are no functions and no expressions: {{randomInt 1 9}}, {{strftime ...}}
  and {{name Updated}} are all wrong, and would be sent to the API as written.
  Seed a literal value in variables, or extract one from an earlier response.
- {{runId}} is seeded for you and is different on every run. Use it wherever a
  value has to be unique — "guest-{{runId}}@example.com" — and do not declare it
  in variables. Dates are not unique, so write those as literals.
- url is relative to baseUrl and starts with /.
- Build every piece of state you need through the API: POST the order, extract
  its id, then read it back, and never assume a row already exists.
- A plan can also carry sql and shell steps, and this is not where one gets
  written: a statement needs the schema, you are shown source files, and a
  column name from here would be invented. Those are drafted where the database
  can be queried first.
- onFailure abort stops the run; continue keeps independent steps going. Use
  abort for the steps everything else depends on.
- Test what the code actually does, including the case it would get wrong. Do
  not repeat a plan that already exists.
- If the endpoints need a logged-in user, sign in first and extract the token.
- You may be shown endpoints and a file beyond the one you are writing for. They
  are there so the plan can sign in and build the state it needs; the plan itself
  tests the file you were told to write for.
- A brief outranks everything else you are shown: write the one plan it asks for,
  and use the endpoints and source only as the means to do it.
- When you are told to cover exact endpoints, every one of them gets a step.`

func messages(req Request) []model.Message {
	return []model.Message{
		{Role: "system", Content: system},
		{Role: "user", Content: brief(req)},
	}
}

func brief(req Request) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Project: %s\nBase URL: %s\n", req.Project, req.BaseURL)
	if req.Focus != "" {
		fmt.Fprintf(&b, "Write the plan for: %s\n", req.Focus)
	}
	if req.Name != "" {
		fmt.Fprintf(&b, "Call the plan: %s\n", req.Name)
	}
	if req.Brief != "" {
		fmt.Fprintf(&b, "\nWrite this plan:\n%s\n", req.Brief)
	}
	if len(req.Cover) > 0 {
		b.WriteString("\nCover exactly these endpoints:\n")
		for _, s := range req.Cover {
			fmt.Fprintf(&b, "- %s\n", s)
		}
	}

	if len(req.Variables) > 0 {
		b.WriteString("\nAlready seeded for you. Reference these as {{name}} and do not " +
			"declare them in variables:\n")
		for _, v := range req.Variables {
			fmt.Fprintf(&b, "- {{%s}}\n", v)
		}
	}

	if len(req.Endpoints) > 0 {
		b.WriteString("\nEndpoints this project serves:\n")
		for _, e := range req.Endpoints {
			fmt.Fprintf(&b, "- %s (%s", e.Signature, e.File)
			if e.Handler != "" {
				fmt.Fprintf(&b, ", %s", e.Handler)
			}
			if e.NeedsAuth {
				b.WriteString(", behind auth")
			}
			b.WriteString(")\n")
		}
	}

	if len(req.Existing) > 0 {
		b.WriteString("\nPlans that already exist:\n")
		for _, p := range req.Existing {
			fmt.Fprintf(&b, "- %s: %s\n", p.Name, strings.Join(p.Endpoints, ", "))
		}
	}

	b.WriteString("\nSource:\n")
	for _, f := range req.Files {
		fmt.Fprintf(&b, "\n--- %s (%s)\n%s\n", f.Path, f.Language, f.Content)
	}
	return b.String()
}

// Parse reads the model's reply as a plan. A prose-wrapped object is unwrapped,
// but nothing is coerced: a plan that will not validate is reported rather than
// patched into something runnable.
func Parse(raw string) (*plan.Plan, error) {
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return nil, errors.New("the reply had no JSON object in it")
	}
	return plan.Parse([]byte(raw[start : end+1]))
}

func correction(err error) string {
	return "That did not validate: " + err.Error() +
		"\nSend the whole plan again as one corrected JSON object."
}

// finish fills in what the model is not the authority on.
func finish(p *plan.Plan, req Request) *plan.Plan {
	if p.Version == 0 {
		p.Version = 1
	}
	if p.BaseURL == "" {
		p.BaseURL = req.BaseURL
	}
	if req.Name != "" {
		p.Name = req.Name
	}
	return p
}
